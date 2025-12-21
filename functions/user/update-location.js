import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {locationRepository} from '../../repositories/LocationRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Update the authenticated user's most recent location for geo queries within
 * a tenant.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcUpdateLocation`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with update result.
 */
async function userUpdateLocationHandler(request, context) {
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
			context.log?.warn?.('Authentication required for update-location:', authError);

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

		const {user_id, latitude, longitude} = body ?? {};

		if (!user_id || typeof latitude !== 'number' || typeof longitude !== 'number') {
			return {
				status: 400,
				jsonBody: {
					error: '`user_id`, `latitude`, and `longitude` required',
				},
			};
		}

		// Ensure user can only update their own location
		if (auth.user_id && auth.user_id !== user_id) {
			return {
				status: 403,
				jsonBody: {error: 'Unauthorized - can only update your own location'},
			};
		}

		// Verify user belongs to this tenant
		let user;
		try {
			user = await authRepository.getUserById(tenant.id, user_id);
		} catch (dbError) {
			context.log?.error?.('Database error while fetching user for location:', dbError);

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

		// Update user location using PostGIS via LocationRepository
		let updateResult;
		try {
			updateResult = await locationRepository.updateUserLocation(
				tenant.id,
				user_id,
				longitude,
				latitude,
			);
		} catch (dbError) {
			context.log?.error?.('Failed to update location:', dbError);

			return {
				status: 500,
				jsonBody: {error: 'Failed to update location'},
			};
		}

		return {
			status: 200,
			jsonBody: {
				success: true,
				updatedAt: updateResult?.last_updated ?? null,
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Internal error in UpdateLocation:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('UpdateLocation', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'user/update-location',
	handler: userUpdateLocationHandler,
});
