import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {locationRepository} from '../../repositories/LocationRepository.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Returns anonymized community activity data for a location within a tenant.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcGetNearbyActivity`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with activity data.
 */
async function userGetNearbyActivityHandler(request, context) {
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
		let auth = null;
		try {
			// Normalize headers into a plain object structure expected by
			// AuthRepository.extractAuthFromRequest.
			let headersObject = request.headers;

			if (headersObject && typeof headersObject.entries === 'function') {
				headersObject = Object.fromEntries(headersObject.entries());
			}

			auth = await authRepository.extractAuthFromRequest({headers: headersObject});
		} catch (authError) {
			context.log?.warn?.('Authentication required for get-nearby-activity:', authError);

			return {
				status: 401,
				jsonBody: {error: 'Authentication required'},
			};
		}

		// Get location from request body
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const {latitude, longitude, radiusKm = 25} = body ?? {};

		if (!latitude || !longitude) {
			return {
				status: 400,
				jsonBody: {error: 'Latitude and longitude required'},
			};
		}

		// Get nearby activity data with tenant context
		let activityData;
		try {
			activityData = await locationRepository.getNearbyActivityData(
				tenant.id,
				latitude,
				longitude,
				radiusKm,
			);
		} catch (serviceError) {
			context.log?.error?.('Failed to retrieve activity data:', serviceError);

			return {
				status: 500,
				jsonBody: {error: 'Failed to retrieve activity data'},
			};
		}

		return {
			status: 200,
			jsonBody: {
				...activityData,
				tenantKey: tenant.key,
				radius: radiusKm,
			},
		};
	} catch (error) {
		context.log?.error?.('Error in GetNearbyActivity:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('GetNearbyActivity', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'user/get-nearby-activity',
	handler: userGetNearbyActivityHandler,
});
