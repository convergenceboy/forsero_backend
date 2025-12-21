import {app, trigger} from '@azure/functions';
import {deleteUserSocketId} from '../../services/tayab/socket-map-service.js';

/**
 * Handle a Socket.IO `disconnected` event by removing the associated user
 * socket mapping from Redis-backed storage.
 *
 * v4 Azure Functions implementation of the legacy v3
 * `tayab_funcOnSocketDisconnected`.
 *
 * Responsibilities:
 * - Consume a `socketiotrigger` for the `disconnected` event from Web PubSub
 *   for Socket.IO.
 * - Extract the authenticated user ID from trigger metadata.
 * - Delete the `(userId -> socketId)` mapping via `deleteUserSocketId`.
 *
 * @param {unknown} _request - Raw trigger payload (not used directly).
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 */
async function realtimeOnSocketDisconnectedHandler(_request, context) {
	try {
		// Get user ID from trigger metadata/binding data.
		const userId =
			context.bindingData?.claims?.sub ||
			context.bindingData?.userId ||
			context.triggerMetadata?.claims?.sub ||
			context.triggerMetadata?.userId;

		// Validate: user ID.
		if (!userId) {
			return;
		}

		// Delete user socket ID from Redis-backed mapping.
		await deleteUserSocketId(userId);

		context.log?.info?.('RealtimeOnSocketDisconnected success', {userId});
	} catch (error) {
		context.log?.warn?.(
			'RealtimeOnSocketDisconnected error',
			/** @type {Error} */ (error)?.message ?? error,
		);
	}
}

app.generic('RealtimeOnSocketDisconnected', {
	trigger: trigger.generic({
		type: 'socketiotrigger',
		hub: 'hub',
		eventName: 'disconnected',
	}),
	handler: realtimeOnSocketDisconnectedHandler,
});
