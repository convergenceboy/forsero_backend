import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {widgetRepository} from '../../repositories/WidgetRepository.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Returns the list of available widgets (not installed) for a given user with
 * tenant support.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcGetWidgets`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with widgets.
 */
async function userGetWidgetsHandler(request, context) {
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
			context.log?.warn?.('Authentication required for get-widgets:', authError);

			return {
				status: 401,
				jsonBody: {error: 'Authentication required'},
			};
		}

		// Read user_id from query or body for backward compatibility
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const queryUserId = request.query?.get?.('user_id');
		const bodyUserId = body?.user_id;
		const userId = queryUserId ?? bodyUserId;

		if (!userId) {
			return {
				status: 400,
				jsonBody: {error: 'Missing user_id'},
			};
		}

		// Ensure user can only get widgets for themselves
		if (auth.user_id && parseInt(auth.user_id, 10) !== parseInt(String(userId), 10)) {
			return {
				status: 403,
				jsonBody: {error: 'Unauthorized - can only access your own data'},
			};
		}

		// Get available widgets with tenant context
		let availableWidgets;
		try {
			availableWidgets =
				await widgetRepository.getAvailableWidgetsForUser(tenant.id, userId);
		} catch (serviceError) {
			context.log?.error?.('Failed to retrieve available widgets:', serviceError);

			return {
				status: 500,
				jsonBody: {error: 'Failed to retrieve available widgets'},
			};
		}

		return {
			status: 200,
			jsonBody: {
				widgets: availableWidgets,
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Internal error in GetWidgets:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('GetWidgets', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'user/get-widgets',
	handler: userGetWidgetsHandler,
});
