import {app, output, trigger} from '@azure/functions';
import {getUserSocketId} from '../../services/tayab/socket-map-service.js';
import {checkUserOnline} from '../../services/tayab/presence-service.js';

const PSI_INITIATE_EVENT = 'psi:initiate';

/**
 * Route PSI initiation messages between users via WebSocket
 * 
 * This function routes PSI protocol messages without inspecting the payload.
 * Privacy is maintained: server only sees routing metadata, not PSI tokens.
 * 
 * v4 Azure Functions implementation for PSI message routing.
 *
 * @param {unknown} _request - Raw trigger payload (not used directly).
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 */
async function realtimeRoutePSIInitiateHandler(_request, context) {
	try {
		// Get sender user ID from trigger metadata
		const fromUserId =
			context.bindingData?.claims?.sub ||
			context.bindingData?.userId ||
			context.triggerMetadata?.claims?.sub ||
			context.triggerMetadata?.userId;

		if (!fromUserId) {
			context.log?.warn?.('RealtimeRoutePSIInitiate missing userId in trigger data');
			return;
		}

		// Get socket ID from trigger metadata
		const socketId =
			context.bindingData?.socketId || context.triggerMetadata?.socketId;

		if (!socketId) {
			context.log?.warn?.('RealtimeRoutePSIInitiate missing socketId in trigger data');
			return;
		}

		// Extract PSI message from trigger data
		// The payload structure: { target_user_id, session_nonce, psi_tokens, timestamp }
		const psiMessage = context.bindingData?.data || context.triggerMetadata?.data;

		if (!psiMessage || !psiMessage.target_user_id) {
			context.log?.warn?.('RealtimeRoutePSIInitiate missing target_user_id in message');
			return;
		}

		const targetUserId = psiMessage.target_user_id;

		// Resolve target user's socket ID
		const toSocketId = await getUserSocketId(Number.parseInt(targetUserId, 10));

		if (!toSocketId) {
			context.log?.info?.('RealtimeRoutePSIInitiate target user not connected', {
				targetUserId,
			});
			return;
		}

		// Check if target user is online
		const {online} = await checkUserOnline(targetUserId);
		if (!online) {
			context.log?.info?.('RealtimeRoutePSIInitiate target user not online', {
				targetUserId,
			});
			return;
		}

		// Route PSI message to target user's socket
		// Note: We forward the entire message without inspection
		const socketMessage = {
			actionName: 'sendToSocket',
			eventName: PSI_INITIATE_EVENT,
			parameters: [psiMessage],
			socketId: String(toSocketId),
		};

		context.extraOutputs?.set?.(socketIOOutput, socketMessage);

		context.log?.info?.('RealtimeRoutePSIInitiate success', {
			fromUserId,
			targetUserId,
			toSocketId,
		});
	} catch (error) {
		context.log?.warn?.(
			'RealtimeRoutePSIInitiate error',
			/** @type {Error} */ (error)?.message ?? error,
		);
	}
}

// Socket.IO output binding for sending events to individual sockets
const socketIOOutput = output.generic({
	type: 'socketio',
	direction: 'out',
	name: 'socketOutput',
	hub: 'hub',
});

// Socket.IO trigger for PSI initiation events
const socketIOTrigger = trigger.generic({
	type: 'socketio',
	direction: 'in',
	name: 'socketTrigger',
	hub: 'hub',
	eventName: PSI_INITIATE_EVENT,
});

app.generic('RealtimeRoutePSIInitiate', {
	trigger: socketIOTrigger,
	extraOutputs: [socketIOOutput],
	handler: realtimeRoutePSIInitiateHandler,
});

