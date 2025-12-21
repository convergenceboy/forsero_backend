import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {widgetRepository} from '../../repositories/WidgetRepository.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Returns the list of installed widgets (and order/config) for a given user
 * within a tenant.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcGetUserWidgets`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with installed widgets.
 */
async function userGetUserWidgetsHandler(request, context) {
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
			context.log?.warn?.('Authentication required for get-user-widgets:', authError);

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

		// Ensure user can only get their own widgets
		if (auth.user_id && parseInt(auth.user_id, 10) !== parseInt(String(userId), 10)) {
			return {
				status: 403,
				jsonBody: {error: 'Unauthorized - can only access your own widgets'},
			};
		}

		// Get user widgets with tenant context
		let widgets;
		try {
			widgets = await widgetRepository.getUserWidgets(tenant.id, userId);
		} catch (serviceError) {
			context.log?.error?.('Failed to retrieve user widgets:', serviceError);

			return {
				status: 500,
				jsonBody: {error: 'Failed to retrieve user widgets'},
			};
		}

		return {
			status: 200,
			jsonBody: {
				widgets,
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Internal error in GetUserWidgets:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('GetUserWidgets', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'user/get-user-widgets',
	handler: userGetUserWidgetsHandler,
});
