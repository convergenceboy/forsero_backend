import {app, output} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {getUserSocketId} from '../../services/tayab/socket-map-service.js';
import {checkUserOnline} from '../../services/tayab/presence-service.js';

const CHAT_REQUEST_ACK_EVENT = 'chat-request-ack';

/**
 * Acknowledge a chat request and notify the target user via Socket.IO.
 *
 * v4 Azure Functions implementation of the legacy v3
 * `tayab_funcAckChatRequest`.
 *
 * Responsibilities:
 * - Resolve and validate tenant access.
 * - Validate JWT-based authentication.
 * - Look up the target user by normalized username.
 * - Ensure the target user is connected and online according to Redis-backed
 *   presence and socket mapping.
 * - Emit a `chat-request-ack` event to the target user's socket via the
 *   Socket.IO output binding.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with ack status.
 */
async function realtimeAckChatRequestHandler(request, context) {
	let tenant = null;
	let auth = null;

	try {
		// Initialize services (non-fatal on failure; log and continue).
		try {
			await initializeApp();
		} catch (initError) {
			context.log?.warn?.(
				'Service initialization failed in RealtimeAckChatRequest:',
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
				'Tenant resolution/validation failed in RealtimeAckChatRequest:',
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
				'Authentication required for realtime ack-chat-request:',
				authError?.message ?? authError,
			);

			return {
				status: 401,
				jsonBody: {error: 'Authentication required'},
			};
		}

		// Extract body and target username.
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const {toUserName} = body ?? {};

		// Validate: target user name is provided.
		if (!toUserName) {
			return {
				status: 400,
				jsonBody: {error: 'toUserName is required'},
			};
		}

		// Normalize usernames for comparison.
		const normalizedToUser = String(toUserName || '').trim().toLowerCase();
		const normalizedFromUser = String(auth.username || '')
			.trim()
			.toLowerCase();

		// Look up the target user by username within the tenant.
		const toUser = await authRepository.getUserByUsername(
			tenant.id,
			normalizedToUser,
		);

		if (!toUser) {
			return {
				status: 404,
				jsonBody: {error: 'Target user not found'},
			};
		}

		// Resolve the target user's current socket ID from Redis.
		const toSocketId = await getUserSocketId(Number.parseInt(toUser.id, 10));

		if (!toSocketId) {
			return {
				status: 404,
				jsonBody: {error: 'Target user is not connected'},
			};
		}

		// Validate that the target user is online according to heartbeat.
		const {online} = await checkUserOnline(toUser.id);
		if (!online) {
			return {
				status: 404,
				jsonBody: {error: 'Target user is not online'},
			};
		}

		// Build event payload and send to target user's socket.
		const fromUserName = normalizedFromUser || undefined;
		const payload = {
			fromUserName,
		};

		const socketMessage = {
			actionName: 'sendToSocket',
			eventName: CHAT_REQUEST_ACK_EVENT,
			parameters: [payload],
			// Use the string form of the target user's socket ID
			// for compatibility with the Socket.IO binding.
			socketId: String(toSocketId),
		};

		context.extraOutputs?.set?.(socketIOOutput, socketMessage);

		context.log?.info?.('RealtimeAckChatRequest success', {
			fromUserName,
			toUserName: normalizedToUser,
			toSocketId,
		});

		return {
			status: 200,
			jsonBody: {success: true},
		};
	} catch (error) {
		context.log?.error?.('Internal error in RealtimeAckChatRequest:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

// Socket.IO output binding for sending events to individual sockets on the "hub".
const socketIOOutput = output.generic({
	type: 'socketio',
	direction: 'out',
	name: 'socketOutput',
	hub: 'hub',
});

app.http('RealtimeAckChatRequest', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'realtime/ack-chat-request',
	extraOutputs: [socketIOOutput],
	handler: realtimeAckChatRequestHandler,
});
