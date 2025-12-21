import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Retrieve a user's public key for ephemeral messaging within a tenant.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcGetUserPublicKey`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with public key info.
 */
async function authGetUserPublicKeyHandler(request, context) {
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
					jsonBody: {error: 'Tenant access denied'},
				};
			}
		} catch (tenantError) {
			context.log?.warn?.('Tenant resolution/validation failed:', tenantError);

			return {
				status: 400,
				jsonBody: {error: 'Invalid tenant domain'},
			};
		}

		// Extract and validate authentication
		try {
			// Normalize Azure Functions v4 HttpRequest headers into a plain
			// object shape expected by AuthRepository.extractAuthFromRequest.
			let headersObject = request.headers;

			// HttpRequest.headers is a Headers-like object; convert if possible.
			if (headersObject && typeof headersObject.entries === 'function') {
				headersObject = Object.fromEntries(headersObject.entries());
			}

			await authRepository.extractAuthFromRequest({headers: headersObject});
		} catch (authError) {
			context.log?.warn?.(
				'Authentication required for get-user-public-key:',
				authError?.message ?? authError,
			);

			return {
				status: 401,
				jsonBody: {error: 'Authentication required'},
			};
		}

		// Validate request body
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const {user_id} = body ?? {};

		if (!user_id) {
			return {
				status: 400,
				jsonBody: {error: 'user_id is required'},
			};
		}

		// Call repository to fetch user public key
		let publicKey;
		try {
			publicKey = await authRepository.getUserPublicKey(tenant.id, user_id);
		} catch (dbError) {
			context.log?.error?.(
				'Database error occurred while fetching user public key:',
				dbError,
			);

			return {
				status: 500,
				jsonBody: {error: 'Internal server error'},
			};
		}

		if (publicKey) {
			return {
				status: 200,
				jsonBody: {
					success: true,
					publicKey,
					user_id,
					tenant: tenant.displayName,
				},
			};
		}

		return {
			status: 404,
			jsonBody: {
				error: 'User not found',
				user_id,
			},
		};
	} catch (error) {
		context.log?.error?.('Internal error in GetUserPublicKey:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('GetUserPublicKey', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'auth/get-user-public-key',
	handler: authGetUserPublicKeyHandler,
});


