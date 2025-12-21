import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {widgetRepository} from '../../repositories/WidgetRepository.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Adds a widget to a user's dashboard with JWT authentication and tenant
 * support.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcAddUserWidget`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with add result.
 */
async function userAddUserWidgetHandler(request, context) {
	let tenant = null;

	try {
		// Initialize services first (non-fatal; log and continue).
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
			context.log?.warn?.('Authentication required for add-user-widget:', authError);

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

		const {
			user_id,
			widgetKey,
			position: rawPosition,
			config = null,
		} = body ?? {};

		const position = rawPosition ?? 0;

		if (!user_id || !widgetKey) {
			return {
				status: 400,
				jsonBody: {error: 'Missing user_id or widgetKey'},
			};
		}

		// Ensure user can only add widgets to their own dashboard
		try {
			authRepository.validateUserOwnership(auth.user_id, user_id);
		} catch (ownershipError) {
			return {
				status: 403,
				jsonBody: {error: ownershipError?.message ?? 'Tenant access denied'},
			};
		}

		// Add widget with tenant context
		try {
			await widgetRepository.addUserWidget(
				tenant.id,
				user_id,
				widgetKey,
				position,
				config,
			);
		} catch (addError) {
			context.log?.error?.('Failed to add widget:', addError);

			return {
				status: 500,
				jsonBody: {error: 'Failed to add widget'},
			};
		}

		return {
			status: 200,
			jsonBody: {
				success: true,
				message: 'Widget added successfully',
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Error in AddUserWidget:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('AddUserWidget', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'user/add-user-widget',
	handler: userAddUserWidgetHandler,
});
