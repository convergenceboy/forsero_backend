import {app, output, trigger} from '@azure/functions';
import {getUserSocketId} from '../../services/tayab/socket-map-service.js';
import {checkUserOnline} from '../../services/tayab/presence-service.js';

const PSI_RESULT_EVENT = 'psi:result';

/**
 * Route PSI result messages between users via WebSocket
 * 
 * This function routes PSI protocol messages without inspecting the payload.
 * Privacy is maintained: server only sees routing metadata, not PSI results.
 * 
 * v4 Azure Functions implementation for PSI message routing.
 *
 * @param {unknown} _request - Raw trigger payload (not used directly).
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 */
async function realtimeRoutePSIResultHandler(_request, context) {
	try {
		// Get sender user ID from trigger metadata
		const fromUserId =
			context.bindingData?.claims?.sub ||
			context.bindingData?.userId ||
			context.triggerMetadata?.claims?.sub ||
			context.triggerMetadata?.userId;

		if (!fromUserId) {
			context.log?.warn?.('RealtimeRoutePSIResult missing userId in trigger data');
			return;
		}

		// Get socket ID from trigger metadata
		const socketId =
			context.bindingData?.socketId || context.triggerMetadata?.socketId;

		if (!socketId) {
			context.log?.warn?.('RealtimeRoutePSIResult missing socketId in trigger data');
			return;
		}

		// Extract PSI message from trigger data
		// The payload structure: { target_user_id, shared_count, shared_interest_ids, timestamp }
		const psiMessage = context.bindingData?.data || context.triggerMetadata?.data;

		if (!psiMessage || !psiMessage.target_user_id) {
			context.log?.warn?.('RealtimeRoutePSIResult missing target_user_id in message');
			return;
		}

		const targetUserId = psiMessage.target_user_id;

		// Resolve target user's socket ID
		const toSocketId = await getUserSocketId(Number.parseInt(targetUserId, 10));

		if (!toSocketId) {
			context.log?.info?.('RealtimeRoutePSIResult target user not connected', {
				targetUserId,
			});
			return;
		}

		// Check if target user is online
		const {online} = await checkUserOnline(targetUserId);
		if (!online) {
			context.log?.info?.('RealtimeRoutePSIResult target user not online', {
				targetUserId,
			});
			return;
		}

		// Route PSI message to target user's socket
		// Note: We forward the entire message without inspection
		const socketMessage = {
			actionName: 'sendToSocket',
			eventName: PSI_RESULT_EVENT,
			parameters: [psiMessage],
			socketId: String(toSocketId),
		};

		context.extraOutputs?.set?.(socketIOOutput, socketMessage);

		context.log?.info?.('RealtimeRoutePSIResult success', {
			fromUserId,
			targetUserId,
			toSocketId,
		});
	} catch (error) {
		context.log?.warn?.(
			'RealtimeRoutePSIResult error',
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

// Socket.IO trigger for PSI result events
const socketIOTrigger = trigger.generic({
	type: 'socketio',
	direction: 'in',
	name: 'socketTrigger',
	hub: 'hub',
	eventName: PSI_RESULT_EVENT,
});

app.generic('RealtimeRoutePSIResult', {
	trigger: socketIOTrigger,
	extraOutputs: [socketIOOutput],
	handler: realtimeRoutePSIResultHandler,
});

