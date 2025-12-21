import {app, output, trigger} from '@azure/functions';
import {getUserSocketId} from '../../services/tayab/socket-map-service.js';
import {checkUserOnline} from '../../services/tayab/presence-service.js';

const PSI_RESPONSE_EVENT = 'psi:response';

/**
 * Route PSI response messages between users via WebSocket
 * 
 * This function routes PSI protocol messages without inspecting the payload.
 * Privacy is maintained: server only sees routing metadata, not PSI tokens.
 * 
 * v4 Azure Functions implementation for PSI message routing.
 *
 * @param {unknown} _request - Raw trigger payload (not used directly).
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 */
async function realtimeRoutePSIResponseHandler(_request, context) {
	try {
		// Get sender user ID from trigger metadata
		const fromUserId =
			context.bindingData?.claims?.sub ||
			context.bindingData?.userId ||
			context.triggerMetadata?.claims?.sub ||
			context.triggerMetadata?.userId;

		if (!fromUserId) {
			context.log?.warn?.('RealtimeRoutePSIResponse missing userId in trigger data');
			return;
		}

		// Get socket ID from trigger metadata
		const socketId =
			context.bindingData?.socketId || context.triggerMetadata?.socketId;

		if (!socketId) {
			context.log?.warn?.('RealtimeRoutePSIResponse missing socketId in trigger data');
			return;
		}

		// Extract PSI message from trigger data
		// The payload structure: { initiator_id, session_nonce, psi_tokens, timestamp }
		const psiMessage = context.bindingData?.data || context.triggerMetadata?.data;

		if (!psiMessage || !psiMessage.initiator_id) {
			context.log?.warn?.('RealtimeRoutePSIResponse missing initiator_id in message');
			return;
		}

		const targetUserId = psiMessage.initiator_id;

		// Resolve target user's socket ID
		const toSocketId = await getUserSocketId(Number.parseInt(targetUserId, 10));

		if (!toSocketId) {
			context.log?.info?.('RealtimeRoutePSIResponse target user not connected', {
				targetUserId,
			});
			return;
		}

		// Check if target user is online
		const {online} = await checkUserOnline(targetUserId);
		if (!online) {
			context.log?.info?.('RealtimeRoutePSIResponse target user not online', {
				targetUserId,
			});
			return;
		}

		// Route PSI message to target user's socket
		// Note: We forward the entire message without inspection
		const socketMessage = {
			actionName: 'sendToSocket',
			eventName: PSI_RESPONSE_EVENT,
			parameters: [psiMessage],
			socketId: String(toSocketId),
		};

		context.extraOutputs?.set?.(socketIOOutput, socketMessage);

		context.log?.info?.('RealtimeRoutePSIResponse success', {
			fromUserId,
			targetUserId,
			toSocketId,
		});
	} catch (error) {
		context.log?.warn?.(
			'RealtimeRoutePSIResponse error',
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

// Socket.IO trigger for PSI response events
const socketIOTrigger = trigger.generic({
	type: 'socketio',
	direction: 'in',
	name: 'socketTrigger',
	hub: 'hub',
	eventName: PSI_RESPONSE_EVENT,
});

app.generic('RealtimeRoutePSIResponse', {
	trigger: socketIOTrigger,
	extraOutputs: [socketIOOutput],
	handler: realtimeRoutePSIResponseHandler,
});

