import jwt from 'jsonwebtoken';
import {app} from '@azure/functions';
import {authRepository} from '../../repositories/AuthRepository.js';
import {initializeApp} from '../../services/serviceInit.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Register new passwordless user account with multi-tenant support.
 * Stores public key and profile data for deterministic authentication.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcPasswordlessRegister`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with registration result.
 */
async function authPasswordlessRegisterHandler(request, context) {
	let tenant = null;

	try {
		// Initialize services (non-fatal if initialization fails; log and continue).
		try {
			await initializeApp();
		} catch (initError) {
			context.log?.warn?.('Service initialization failed:', initError.message);
		}

		// Resolve tenant from request
		try {
			tenant = await resolveTenant(request);

			if (!validateTenantAccess(tenant, 'write')) {
				return {
					status: 403,
					jsonBody: {error: 'Tenant access denied'},
				};
			}
		} catch (tenantError) {
			context.log?.warn?.('Tenant resolution/validation failed:', tenantError);

			return {
				status: 400,
				jsonBody: {error: 'Invalid tenant configuration'},
			};
		}

		// Input validation
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const {username, publicKey} = body ?? {};

		if (!username || !publicKey) {
			return {
				status: 400,
				jsonBody: {
					error: 'Missing required fields',
					required: ['username', 'publicKey'],
				},
			};
		}

		// Validate username format
		const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
		if (!usernameRegex.test(username)) {
			return {
				status: 400,
				jsonBody: {
					error:
						'Username must be 3-20 characters, letters, numbers, underscore, or dash only',
				},
			};
		}

		// Check username availability within tenant
		let isUsernameAvailable;
		try {
			isUsernameAvailable = await authRepository.checkUsernameAvailability(
				tenant.id,
				username,
			);
		} catch (usernameError) {
			context.log?.error?.(
				'Database error during username check:',
				usernameError,
			);

			return {
				status: 500,
				jsonBody: {error: 'Database error during username check'},
			};
		}

		if (!isUsernameAvailable) {
			return {
				status: 409,
				jsonBody: {error: 'Username already taken'},
			};
		}

		// Insert new passwordless user with tenant association
		let newUser;
		try {
			newUser = await authRepository.createPasswordlessUser(
				tenant.id,
				username,
				publicKey,
			);
		} catch (createError) {
			context.log?.error?.('Database error during registration:', createError);

			return {
				status: 500,
				jsonBody: {error: 'Database error during registration'},
			};
		}

		// Generate JWT token with tenant context (preserve legacy behavior)
		const jwtSecret =
			process.env.JWT_SECRET ??
			'your-super-secret-jwt-key-change-in-production-make-it-long-and-random';

		const token = jwt.sign(
			{
				user_id: newUser.id,
				username: newUser.username,
				tenant_id: tenant.id,
				tenantKey: tenant.key,
				type: 'passwordless',
			},
			jwtSecret,
			{expiresIn: '24h'},
		);

		return {
			status: 201,
			jsonBody: {
				success: true,
				token,
				user: {
					user_id: newUser.id,
					username: newUser.username,
					registrationDate: newUser.created_at,
					tenant: tenant.displayName,
				},
				message: 'Passwordless account created successfully',
			},
		};
	} catch (error) {
		context.log?.error?.('Registration error:', error);

		// Preserve unique-violation special-case handling
		if (error?.code === '23505') {
			return {
				status: 409,
				jsonBody: {error: 'Username already taken'},
			};
		}

		return {
			status: 500,
			jsonBody: {error: 'Registration failed'},
		};
	}
}

app.http('PasswordlessRegister', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'auth/passwordless-register',
	handler: authPasswordlessRegisterHandler,
});

