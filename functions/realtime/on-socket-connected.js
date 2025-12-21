import {app, trigger} from '@azure/functions';
import {setUserSocketId} from '../../services/tayab/socket-map-service.js';

/**
 * Handle a Socket.IO `connected` event by associating a user ID with the
 * current socket ID in Redis-backed socket mapping storage.
 *
 * v4 Azure Functions implementation of the legacy v3
 * `tayab_funcOnSocketConnected`.
 *
 * Responsibilities:
 * - Consume a `socketiotrigger` for the `connected` event from Web PubSub
 *   for Socket.IO.
 * - Extract the socket ID and authenticated user ID from trigger metadata.
 * - Persist the mapping `(userId -> socketId)` via `setUserSocketId`.
 *
 * @param {unknown} _request - Raw trigger payload (not used directly).
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 */
async function realtimeOnSocketConnectedHandler(_request, context) {
	try {
		// Get socket ID from trigger metadata/binding data.
		const socketId =
			context.bindingData?.socketId || context.triggerMetadata?.socketId;

		// Validate: socket ID.
		if (!socketId) {
			context.log?.warn?.(
				'RealtimeOnSocketConnected missing socketId in trigger data',
				{
					bindingDataKeys: Object.keys(context.bindingData || {}),
					triggerMetadataKeys: Object.keys(context.triggerMetadata || {}),
				},
			);
			return;
		}

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

		// Set user socket ID in Redis-backed mapping.
		await setUserSocketId(userId, socketId);

		context.log?.info?.('RealtimeOnSocketConnected success', {userId, socketId});
	} catch (error) {
		context.log?.warn?.(
			'RealtimeOnSocketConnected error',
			/** @type {Error} */ (error)?.message ?? error,
		);
	}
}

app.generic('RealtimeOnSocketConnected', {
	trigger: trigger.generic({
		type: 'socketiotrigger',
		hub: 'hub',
		eventName: 'connected',
	}),
	handler: realtimeOnSocketConnectedHandler,
});
