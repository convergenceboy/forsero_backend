import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {interestRepository} from '../../repositories/InterestRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Update the authenticated user's interest hashes within a tenant.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcUpdateInterests`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with update result.
 */
async function userUpdateInterestsHandler(request, context) {
	let tenant = null;

	try {
		// Initialize services (non-fatal if initialization fails; log and continue).
		try {
			await initializeApp();
		} catch (initError) {
			context.log?.warn?.('Service initialization failed:', initError.message);
		}

		// Resolve tenant from request domain
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
				jsonBody: {error: 'Invalid tenant domain'},
			};
		}

		// Authenticate user and get user info
		let userInfo;
		try {
			// Normalize headers into a plain object structure expected by
			// AuthRepository.extractAuthFromRequest.
			let headersObject = request.headers;

			if (headersObject && typeof headersObject.entries === 'function') {
				headersObject = Object.fromEntries(headersObject.entries());
			}

			userInfo = await authRepository.extractAuthFromRequest({
				headers: headersObject,
			});
		} catch (authError) {
			context.log?.warn?.(
				'Authentication required for update-interests:',
				authError?.message ?? authError,
			);

			return {
				status: 401,
				jsonBody: {error: 'Authentication required'},
			};
		}

		// Parse request body
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const {user_id, interest_hashes} = body ?? {};

		if (!interest_hashes || !Array.isArray(interest_hashes)) {
			return {
				status: 400,
				jsonBody: {
					error: 'Missing or invalid interest_hashes array in request body',
				},
			};
		}

		// Ensure user can only update their own interests
		if (userInfo.user_id !== user_id) {
			return {
				status: 403,
				jsonBody: {error: 'Unauthorized - can only update your own interests'},
			};
		}

		// Note: Interests are now stored locally on the client device in SQLite.
		// This endpoint is kept for API compatibility but does not persist to the database.
		let result;
		try {
			result = await interestRepository.saveUserInterests(
				userInfo.user_id,
				tenant.id,
				interest_hashes,
			);
		} catch (dbError) {
			context.log?.error?.('Failed to process interests update:', dbError);

			return {
				status: 500,
				jsonBody: {error: 'Failed to process interests update'},
			};
		}

		return {
			status: 200,
			jsonBody: {
				message: 'Interests processed successfully (stored locally on device)',
				user_id: userInfo.user_id,
				interestsCount: result?.count ?? 0,
				tenant: tenant.displayName,
				note: 'Interests are stored locally on your device',
			},
		};
	} catch (error) {
		context.log?.error?.('Internal error in UpdateInterests:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('UpdateInterests', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'user/update-interests',
	handler: userUpdateInterestsHandler,
});

