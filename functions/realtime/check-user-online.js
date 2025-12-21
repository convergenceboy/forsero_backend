import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {checkUserOnline} from '../../services/tayab/presence-service.js';

/**
 * Check whether a user is online using Redis-backed heartbeat presence.
 *
 * v4 Azure Functions implementation of the legacy v3 `tayab_funcCheckUserOnline`.
 *
 * Responsibilities:
 * - Resolve and validate tenant access.
 * - Validate JWT-based authentication.
 * - Resolve a user by normalized username to obtain a user ID.
 * - Query Redis-backed presence via `checkUserOnline` and surface the result.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with online status.
 */
async function realtimeCheckUserOnlineHandler(request, context) {
	let tenant = null;

	try {
		// Initialize services (non-fatal on failure; log and continue).
		try {
			await initializeApp();
		} catch (initError) {
			context.log?.warn?.(
				'Service initialization failed in RealtimeCheckUserOnline:',
				initError?.message ?? initError,
			);
		}

		// Resolve tenant from request and validate access.
		try {
			tenant = await resolveTenant(request);

			if (!validateTenantAccess(tenant, 'read')) {
				return {
					status: 403,
					jsonBody: {error: 'Tenant access denied'},
				};
			}
		} catch (tenantError) {
			context.log?.warn?.(
				'Tenant resolution/validation failed in RealtimeCheckUserOnline:',
				tenantError,
			);

			return {
				status: 400,
				jsonBody: {error: 'Invalid tenant domain'},
			};
		}

		// Extract and validate authentication.
		try {
			// Normalize Azure Functions v4 HttpRequest headers into the plain
			// object shape expected by AuthRepository.extractAuthFromRequest.
			let headersObject = request.headers;

			if (headersObject && typeof headersObject.entries === 'function') {
				headersObject = Object.fromEntries(headersObject.entries());
			}

			await authRepository.extractAuthFromRequest({headers: headersObject});
		} catch (authError) {
			context.log?.warn?.(
				'Authentication required for realtime check-user-online:',
				authError?.message ?? authError,
			);

			return {
				status: 401,
				jsonBody: {error: 'Authentication required'},
			};
		}

		// Extract body and username.
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		// Support both legacy `userName` and more conventional `username` fields.
		const {userName, username} = body ?? {};
		const rawUserName = userName ?? username;

		// Validate: userName.
		if (!rawUserName) {
			return {
				status: 400,
				jsonBody: {error: 'userName is required'},
			};
		}

		// Resolve user by username to get userId.
		let userId;
		try {
			const normalizedUserName = String(rawUserName || '')
				.trim()
				.toLowerCase();
			const user = await authRepository.getUserByUsername(
				tenant.id,
				normalizedUserName,
			);

			if (!user) {
				context.log?.info?.('RealtimeCheckUserOnline user not found', {
					username: normalizedUserName,
				});

				return {
					status: 200,
					jsonBody: {online: false, lastHeartbeat: null},
				};
			}

			userId = user.id;
		} catch (lookupError) {
			context.log?.warn?.(
				'RealtimeCheckUserOnline user lookup failed',
				lookupError?.message ?? lookupError,
			);

			return {
				status: 200,
				jsonBody: {online: false, lastHeartbeat: null},
			};
		}

		// Check if user is online using Redis-backed heartbeat.
		const {online, lastHeartbeat} = await checkUserOnline(userId, 10_000);

		context.log?.info?.('RealtimeCheckUserOnline success', {
			userId,
			online,
			lastHeartbeat,
		});

		return {
			status: 200,
			jsonBody: {online, lastHeartbeat},
		};
	} catch (error) {
		context.log?.error?.('Internal error in RealtimeCheckUserOnline:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('RealtimeCheckUserOnline', {
	methods: ['GET', 'POST'],
	authLevel: 'function',
	route: 'realtime/check-user-online',
	handler: realtimeCheckUserOnlineHandler,
});
