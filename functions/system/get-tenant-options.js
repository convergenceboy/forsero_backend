import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {tenantRepository} from '../../repositories/index.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Returns age brackets and maturity levels for a tenant with proper security
 * and error handling.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcGetTenantOptions`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with tenant options.
 */
async function systemGetTenantOptionsHandler(request, context) {
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
				jsonBody: {error: 'Invalid tenant configuration'},
			};
		}

		// Get tenant options (age brackets and maturity levels)
		let options;
		try {
			options = await tenantRepository.getTenantOptions(tenant.id);
		} catch (dbError) {
			context.log?.error?.('Failed to retrieve tenant options:', dbError);

			return {
				status: 500,
				jsonBody: {error: 'Failed to retrieve tenant options'},
			};
		}

		return {
			status: 200,
			jsonBody: {
				...options,
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Error in GetTenantOptions:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('GetTenantOptions', {
	methods: ['GET', 'POST'],
	authLevel: 'function',
	route: 'system/get-tenant-options',
	handler: systemGetTenantOptionsHandler,
});

