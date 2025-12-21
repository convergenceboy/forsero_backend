import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {getUserSocketId} from '../../services/tayab/socket-map-service.js';

/**
 * Get the associated Socket.IO connection ID for the authenticated user.
 *
 * v4 Azure Functions implementation of the legacy v3
 * `tayab_funcGetAssociatedSocketId`.
 *
 * Responsibilities:
 * - Resolve and validate tenant access.
 * - Validate JWT-based authentication.
 * - Derive the calling user's ID from the auth context.
 * - Look up the user's current socket ID from Redis-backed socket map.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with socket mapping.
 */
async function realtimeGetAssociatedSocketIdHandler(request, context) {
	let tenant = null;
	let auth = null;

	try {
		// Initialize services (non-fatal on failure; log and continue).
		try {
			await initializeApp();
		} catch (initError) {
			context.log?.warn?.(
				'Service initialization failed in RealtimeGetAssociatedSocketId:',
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
				'Tenant resolution/validation failed in RealtimeGetAssociatedSocketId:',
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

			auth = await authRepository.extractAuthFromRequest({headers: headersObject});
		} catch (authError) {
			context.log?.warn?.(
				'Authentication required for realtime get-associated-socket-id:',
				authError?.message ?? authError,
			);

			return {
				status: 401,
				jsonBody: {error: 'Authentication required'},
			};
		}

		// Get user ID from auth context.
		const userId = Number.parseInt(auth?.user_id, 10);

		// Validate: user ID.
		if (!userId) {
			return {
				status: 400,
				jsonBody: {error: 'Invalid user id'},
			};
		}

		// Look up user's socket ID in the socket map (Redis).
		const socketId = await getUserSocketId(userId);

		context.log?.info?.('RealtimeGetAssociatedSocketId success', {
			userId,
			socketId,
		});

		return {
			status: 200,
			jsonBody: {
				userId,
				socketId: socketId || null,
			},
		};
	} catch (error) {
		context.log?.error?.(
			'Internal error in RealtimeGetAssociatedSocketId:',
			error,
		);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

app.http('RealtimeGetAssociatedSocketId', {
	methods: ['GET', 'POST'],
	authLevel: 'function',
	route: 'realtime/get-associated-socket-id',
	handler: realtimeGetAssociatedSocketIdHandler,
});
