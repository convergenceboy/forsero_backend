import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {tenantRepository} from '../../repositories/index.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Query Postgres for full normalized taxonomy and return it in a structure
 * compatible with the refactored InterestsScreen.js. Multi-tenant aware
 * implementation.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcGetTaxonomy`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with taxonomy data.
 */
async function systemGetTaxonomyHandler(request, context) {
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

		// Get tenant-specific taxonomy data - full hierarchy
		let taxonomy;
		try {
			// Require maturity rating filter in query parameters
			const maxMaturityRating =
				request.query.get('maturityRating') ??
				request.query.get('maturityrating');

			if (!maxMaturityRating) {
				return {
					status: 400,
					headers: {'Content-Type': 'application/json'},
					jsonBody: {error: 'maturityRating parameter is required'},
				};
			}

			taxonomy = await tenantRepository.getTenantTaxonomy(
				tenant.id,
				maxMaturityRating,
			);
		} catch (dbError) {
			context.log?.error?.('Database error occurred while getting taxonomy:', dbError);

			return {
				status: 500,
				jsonBody: {error: 'Database error occurred'},
			};
		}

		return {
			status: 200,
			headers: {'Content-Type': 'application/json'},
			jsonBody: {
				categories: taxonomy,
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Error in GetTaxonomy:', error);

		return {
			status: 500,
			headers: {'Content-Type': 'application/json'},
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('GetTaxonomy', {
	methods: ['GET'],
	authLevel: 'function',
	route: 'system/get-taxonomy',
	handler: systemGetTaxonomyHandler,
});

