import {app, trigger} from '@azure/functions';
import {userHeartbeat} from '../../services/tayab/presence-service.js';

/**
 * Record a heartbeat for a connected user based on a Socket.IO-triggered
 * event.
 *
 * v4 Azure Functions implementation of the legacy v3
 * `tayab_funcHeartbeat`.
 *
 * Responsibilities:
 * - Consume `socketiotrigger` metadata from Web PubSub for Socket.IO.
 * - Extract the authenticated user ID from trigger metadata/claims.
 * - Record a heartbeat timestamp for the user in Redis-backed presence
 *   storage via `userHeartbeat`.
 *
 * This function does not produce any outbound Socket.IO messages; it is an
 * internal presence-tracking hook.
 *
 * @param {unknown} _request - Raw trigger payload (not used).
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 */
async function realtimeHeartbeatHandler(_request, context) {
	try {
		// Get user ID from trigger metadata/binding data. Different runtime
		// versions surface these values on either bindingData or
		// triggerMetadata, so we check both to keep the function portable
		// between local and Azure.
		const userId =
			context.bindingData?.claims?.sub ||
			context.bindingData?.userId ||
			context.triggerMetadata?.claims?.sub ||
			context.triggerMetadata?.userId;

		if (!userId) {
			// If the trigger did not carry a user identifier, there is nothing
			// to record; log at debug level only.
			context.log?.debug?.('RealtimeHeartbeat invoked without userId');
			return;
		}

		// Record user heartbeat timestamp in Redis-backed presence storage.
		const now = Date.now();
		await userHeartbeat(userId, now);

		context.log?.info?.('RealtimeHeartbeat success', {userId, now});
	} catch (error) {
		// Heartbeat failures should not crash the host; log a warning but do not
		// rethrow.
		context.log?.warn?.(
			'RealtimeHeartbeat error',
			/** @type {Error} */ (error)?.message ?? error,
		);
	}
}

app.generic('RealtimeHeartbeat', {
	trigger: trigger.generic({
		type: 'socketiotrigger',
		hub: 'hub',
		eventName: 'heartbeat',
		parameterNames: [],
	}),
	handler: realtimeHeartbeatHandler,
});
