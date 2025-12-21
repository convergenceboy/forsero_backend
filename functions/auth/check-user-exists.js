import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Check whether a username exists within the resolved tenant.
 *
 * v4 Azure Functions implementation of the legacy v3 `tayab_funcUserExists`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with existence flag.
 */
async function authCheckUserExistsHandler(request, context) {
	let tenant = null;

	try {
		// Initialize services (non-fatal if initialization fails; log and continue).
		try {
			await initializeApp();
		} catch (initError) {
			context.log?.warn?.('Service initialization failed:', initError.message);
		}

		// Resolve tenant from request and validate access.
		try {
			tenant = await resolveTenant(request);

			if (!validateTenantAccess(tenant, 'read')) {
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

		// Extract username from JSON body. Support both legacy `userName` and
		// a more conventional `username` field for forward compatibility.
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const {userName, username} = body ?? {};
		const rawUserName = userName ?? username;

		if (!rawUserName || typeof rawUserName !== 'string') {
			return {
				status: 400,
				jsonBody: {error: 'Username is required'},
			};
		}

		const normalizedUserName = String(rawUserName || '').trim().toLowerCase();

		// Check if user exists in the tenant.
		const user = await authRepository.getUserByUsername(
			tenant.id,
			normalizedUserName,
		);
		const exists = Boolean(user);

		context.log?.info?.('CheckUserExists success', {
			username: normalizedUserName,
			exists,
		});

		return {
			status: 200,
			jsonBody: {
				exists,
				username: normalizedUserName,
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Internal error in CheckUserExists:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('CheckUserExists', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'auth/check-user-exists',
	handler: authCheckUserExistsHandler,
});
