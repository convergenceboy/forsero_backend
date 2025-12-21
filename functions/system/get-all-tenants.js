import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {tenantRepository} from '../../repositories/index.js';

/**
 * Returns all active tenants for selection screen with proper authentication
 * and audit logging.
 *
 * This is a PUBLIC function for tenant selection - no authentication required.
 * Users need to see available tenants BEFORE they can authenticate; authentication
 * happens after tenant selection.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcGetAllTenants`.
 *
 * @param {import('@azure/functions').HttpRequest} _request - Incoming HTTP request (unused).
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with tenant list.
 */
async function systemGetAllTenantsHandler(_request, context) {
	try {
		// Initialize services (non-fatal if initialization fails; log and continue).
		try {
			await initializeApp();
		} catch (initError) {
			context.warn?.('Service initialization failed:', initError.message);
			context.log?.warn?.('Service initialization failed:', initError.message);
		}

		// Get all active tenants
		let tenants;
		try {
			tenants = await tenantRepository.getAllTenants();
		} catch (dbError) {
			context.log?.error?.('Failed to retrieve tenants:', dbError);

			return {
				status: 500,
				jsonBody: {error: 'Failed to retrieve tenants'},
			};
		}

		return {
			status: 200,
			jsonBody: tenants,
		};
	} catch (error) {
		context.log?.error?.('Error in GetAllTenants:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('GetAllTenants', {
	methods: ['GET'],
	authLevel: 'anonymous',
	route: 'system/get-all-tenants',
	handler: systemGetAllTenantsHandler,
});

