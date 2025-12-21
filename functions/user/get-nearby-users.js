import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {locationRepository} from '../../repositories/LocationRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Get nearby users (location-only, no interest matching)
 * Used for PSI: server only returns user IDs, locations, and public keys
 * 
 * v4 Azure Functions implementation for client-side PSI matching.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with nearby users.
 */
async function userGetNearbyUsersHandler(request, context) {
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
			context.log?.warn?.('Authentication required for get-nearby-users:', authError);

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

		const {user_id, latitude, longitude, radius_meters} = body ?? {};

		if (!user_id || typeof latitude !== 'number' || typeof longitude !== 'number') {
			return {
				status: 400,
				jsonBody: {
					error: '`user_id`, `latitude`, and `longitude` are required',
				},
			};
		}

		// Ensure user can only get nearby users for themselves
		if (auth.user_id !== user_id) {
			return {
				status: 403,
				jsonBody: {error: 'Unauthorized - can only get nearby users for yourself'},
			};
		}

		// Verify user belongs to this tenant
		let user;
		try {
			user = await authRepository.getUserById(tenant.id, user_id);
		} catch (dbError) {
			context.log?.error?.('Database error while fetching user:', dbError);

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

		// Get nearby users (location only, no interest matching)
		const radiusMeters = radius_meters || 50;
		const maxUsers = 50;

		let nearbyUsers;
		try {
			nearbyUsers = await locationRepository.findNearbyUsers(
				tenant.id,
				longitude,
				latitude,
				user_id,
				radiusMeters,
				maxUsers,
			);
		} catch (dbError) {
			context.log?.error?.('Failed to retrieve nearby users:', dbError);

			return {
				status: 500,
				jsonBody: {error: 'Failed to retrieve nearby users'},
			};
		}

		// Fetch public keys for all nearby users (required for PSI)
		const usersWithKeys = await Promise.all(
			nearbyUsers.map(async (nearbyUser) => {
				try {
					const publicKey = await authRepository.getUserPublicKey(
						tenant.id,
						nearbyUser.user_id,
					);
					return {
						user_id: nearbyUser.user_id,
						distance: nearbyUser.distance,
						public_key: publicKey || null,
					};
				} catch (error) {
					context.log?.warn?.(
						`Failed to get public key for user ${nearbyUser.user_id}:`,
						error,
					);
					// Include user even if public key fetch fails (they can retry)
					return {
						user_id: nearbyUser.user_id,
						distance: nearbyUser.distance,
						public_key: null,
					};
				}
			}),
		);

		// Filter out users without public keys (they can't participate in PSI)
		const validUsers = usersWithKeys.filter((user) => user.public_key !== null);

		return {
			status: 200,
			jsonBody: {
				users: validUsers,
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Error in GetNearbyUsers:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('GetNearbyUsers', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'user/get-nearby-users',
	handler: userGetNearbyUsersHandler,
});

