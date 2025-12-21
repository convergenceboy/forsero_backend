import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {interestRepository} from '../../repositories/InterestRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Retrieve nearby user matches based on shared interests and location within a
 * tenant.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcGetMatches`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with matches.
 */
async function userGetMatchesHandler(request, context) {
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

		// Extract and validate JWT token
		let auth;
		try {
			// Normalize headers into a plain object structure expected by
			// AuthRepository.extractAuthFromRequest.
			let headersObject = request.headers;

			if (headersObject && typeof headersObject.entries === 'function') {
				headersObject = Object.fromEntries(headersObject.entries());
			}

			auth = await authRepository.extractAuthFromRequest({headers: headersObject});
		} catch (authError) {
			context.log?.warn?.('Authentication required for get-matches:', authError);

			return {
				status: 401,
				jsonBody: {error: 'Authentication required'},
			};
		}

		// Parse and validate request body
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const {user_id, latitude, longitude, hashedInterests} = body ?? {};

		if (!user_id || !latitude || !longitude || !Array.isArray(hashedInterests)) {
			return {
				status: 400,
				jsonBody: {
					error:
						'`user_id`, `latitude`, `longitude`, and `hashedInterests` required',
				},
			};
		}

		// Ensure user can only get matches for themselves
		if (auth.user_id !== user_id) {
			return {
				status: 403,
				jsonBody: {error: 'Unauthorized - can only get matches for yourself'},
			};
		}

		// Verify user belongs to this tenant
		let user;
		try {
			user = await authRepository.getUserById(tenant.id, user_id);
		} catch (dbError) {
			context.log?.error?.('Database error while fetching user for matches:', dbError);

			return {
				status: 500,
				jsonBody: {error: 'Database error occurred'},
			};
		}

		if (!user) {
			return {
				status: 403,
				jsonBody: {error: 'User not found in tenant'},
			};
		}

		// Get tenant-aware matches using PostGIS via InterestRepository
		const radiusMeters = 50;
		const maxUsers = 50;

		let matches;
		try {
			matches = await interestRepository.findNearbyUsersWithSharedInterests(
				tenant.id,
				longitude,
				latitude,
				user_id,
				radiusMeters,
				hashedInterests,
				maxUsers,
			);
		} catch (dbError) {
			context.log?.error?.('Failed to retrieve matches:', dbError);

			return {
				status: 500,
				jsonBody: {error: 'Failed to retrieve matches'},
			};
		}

		return {
			status: 200,
			jsonBody: {
				matches,
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Error in GetMatches:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('GetMatches', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'user/get-matches',
	handler: userGetMatchesHandler,
});
