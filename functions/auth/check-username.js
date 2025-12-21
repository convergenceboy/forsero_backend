import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Check username availability for passwordless registration with multi-tenant support.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcCheckUsername`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with availability info.
 */
async function authCheckUsernameHandler(request, context) {
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

			if (!validateTenantAccess(tenant, 'read')) {
				return {
					status: 403,
					jsonBody: 'Tenant access denied',
				};
			}
		} catch (tenantError) {
			context.log?.warn?.('Tenant resolution/validation failed:', tenantError);

			return {
				status: 400,
				jsonBody: 'Invalid tenant configuration',
			};
		}

		// Extract username from JSON body
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const {username} = body ?? {};

		if (!username || typeof username !== 'string') {
			return {
				status: 400,
				jsonBody: 'Username is required',
			};
		}

		// Validate username format
		const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
		if (!usernameRegex.test(username)) {
			return {
				status: 400,
				jsonBody:
					'Username must be 3-20 characters, letters, numbers, underscore, or dash only',
			};
		}

		// Check username availability in tenant context
		let isAvailable;
		try {
			isAvailable = await authRepository.isUsernameAvailable(tenant.id, username);
		} catch (dbError) {
			context.log?.error?.('Database error occurred while checking username:', dbError);

			return {
				status: 500,
				jsonBody: 'Database error occurred',
			};
		}

		// Generate suggestions if username is not available
		let suggestions = [];
		if (!isAvailable) {
			const allSuggestions =
				authRepository.generateUsernameSuggestions(username);

			try {
				const availableSuggestions =
					await authRepository.checkMultipleUsernames(
						tenant.id,
						allSuggestions,
					);
				suggestions = availableSuggestions.slice(0, 3);
			} catch (suggestionError) {
				context.log?.warn?.(
					'Error checking username suggestions:',
					suggestionError?.message ?? suggestionError,
				);
				// Continue without suggestions rather than failing completely
				suggestions = [];
			}
		}

		return {
			status: 200,
			jsonBody: {
				available: isAvailable,
				username,
				suggestions,
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Username check error:', error);

		return {
			status: 500,
			jsonBody: 'Internal server error',
		};
	}
}

app.http('CheckUsername', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'auth/check-username',
	handler: authCheckUsernameHandler,
});

