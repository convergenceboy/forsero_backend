import {app, output, trigger} from '@azure/functions';

const PONG_EVENT = 'pong';

/**
 * Handle a Socket.IO `ping` event by sending a `pong` message back to the
 * originating socket.
 *
 * v4 Azure Functions implementation of the legacy v3
 * `tayab_funcOnPingMessage`.
 *
 * Responsibilities:
 * - Consume a `socketiotrigger` for the `ping` event from Web PubSub for
 *   Socket.IO.
 * - Extract the originating user and socket identifiers from trigger
 *   metadata.
 * - Emit a `pong` event back to the same socket using the Socket.IO output
 *   binding.
 *
 * @param {unknown} _request - Raw trigger payload (not used directly).
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 */
async function realtimeOnPingMessageHandler(_request, context) {
	try {
		// Get from user ID from trigger metadata/binding data. Different runtime
		// versions surface these values on either bindingData or
		// triggerMetadata, so we check both to keep the function portable
		// between local and Azure.
		const fromUserId =
			context.bindingData?.claims?.sub ||
			context.bindingData?.userId ||
			context.triggerMetadata?.claims?.sub ||
			context.triggerMetadata?.userId;

		const message = 'Pong!';

		// Get socket ID from trigger metadata/binding data.
		const socketId =
			context.bindingData?.socketId || context.triggerMetadata?.socketId;

		// Validate: socket ID.
		if (!socketId) {
			context.log?.warn?.('RealtimeOnPingMessage missing socketId in trigger data', {
				bindingDataKeys: Object.keys(context.bindingData || {}),
				triggerMetadataKeys: Object.keys(context.triggerMetadata || {}),
			});
			return;
		}

		// Send pong message to the sender socket.
		const socketMessage = {
			actionName: 'sendToSocket',
			socketId: String(socketId),
			eventName: PONG_EVENT,
			parameters: [message],
		};

		context.extraOutputs?.set?.(socketIOOutput, socketMessage);

		context.log?.info?.('RealtimeOnPingMessage success', {
			fromUserId,
			socketId,
			message,
		});
	} catch (error) {
		context.log?.warn?.(
			'RealtimeOnPingMessage error',
			/** @type {Error} */ (error)?.message ?? error,
		);
	}
}

// Socket.IO output binding for sending events back to individual sockets on
// the "hub".
const socketIOOutput = output.generic({
	type: 'socketio',
	direction: 'out',
	name: 'socketOutput',
	hub: 'hub',
});

app.generic('RealtimeOnPingMessage', {
	trigger: trigger.generic({
		type: 'socketiotrigger',
		hub: 'hub',
		eventName: 'ping',
		parameterNames: ['message'],
	}),
	extraOutputs: [socketIOOutput],
	handler: realtimeOnPingMessageHandler,
});
