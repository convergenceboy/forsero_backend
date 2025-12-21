import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {tenantRepository} from '../../repositories/index.js';
import {authRepository} from '../../repositories/AuthRepository.js';

/**
 * Returns tenant configuration by domain with proper authentication and security.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcGetTenantConfig`.
 *
 * - If the request is authenticated, returns full tenant configuration.
 * - If unauthenticated, returns limited public configuration.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with tenant config.
 */
async function systemGetTenantConfigHandler(request, context) {
	try {
		// Initialize services (non-fatal if initialization fails; log and continue).
		try {
			await initializeApp();
		} catch (initError) {
			context.log?.warn?.('Service initialization failed:', initError.message);
		}

		// Get domain from query or body
		let domain = request.query.get('domain');

		if (!domain) {
			try {
				const body = await request.json();
				domain = body?.domain;
			} catch {
				// Ignore JSON parse errors; domain may still be missing.
			}
		}

		if (!domain) {
			return {
				status: 400,
				jsonBody: {error: 'Missing domain parameter'},
			};
		}

		// Check if request is authenticated
		let isAuthenticated = false;
		try {
			// extractAuthFromRequest will throw if not authenticated or invalid
			await authRepository.extractAuthFromRequest(request);
			isAuthenticated = true;
		} catch (authError) {
			// Not authenticated - will return public config only
			context.log?.warn?.(
				'Request not authenticated, returning public tenant configuration only',
				authError?.message ?? authError,
			);
			isAuthenticated = false;
		}

		// Get tenant configuration based on authentication status
		let tenantConfig;
		try {
			if (isAuthenticated) {
				// Return full configuration for authenticated users
				tenantConfig = await tenantRepository.getTenantConfigByDomain(domain);
			} else {
				// Return limited public configuration for unauthenticated requests
				tenantConfig = await tenantRepository.getTenantPublicConfig(domain);
			}
		} catch (dbError) {
			context.log?.error?.(
				'Failed to retrieve tenant configuration:',
				dbError,
			);

			return {
				status: 500,
				jsonBody: {error: 'Failed to retrieve tenant configuration'},
			};
		}

		if (!tenantConfig) {
			return {
				status: 404,
				jsonBody: {error: 'Tenant not found'},
			};
		}

		return {
			status: 200,
			jsonBody: tenantConfig,
		};
	} catch (error) {
		context.log?.error?.('Error in GetTenantConfig:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('GetTenantConfig', {
	methods: ['GET', 'POST'],
	authLevel: 'function',
	route: 'system/get-tenant-config',
	handler: systemGetTenantConfigHandler,
});

