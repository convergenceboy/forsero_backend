## RealtimeHeartbeat Conversion Report

### Function overview

- **Original name**: `tayab_funcHeartbeat`
- **Category**: `realtime` / Socket.IO presence
- **Purpose**: Consume `heartbeat` events from Web PubSub for Socket.IO and record a heartbeat timestamp for the associated user in Redis-backed presence storage.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcHeartbeat/index.js`
- **Trigger**: `socketiotrigger` (Socket.IO trigger), not HTTP.
- **Bindings** (from `function.json`):
  ```json
  {
    "bindings": [
      {
        "type": "socketiotrigger",
        "direction": "in",
        "name": "trigger",
        "hub": "hub",
        "eventName": "heartbeat",
        "parameterNames": []
      }
    ]
  }
  ```
- **Behavior**:
  - Imports `userHeartbeat` from `../services/tayab/presence-service.js`.
  - On invocation:
    - Extracts `userId` from trigger metadata / binding data:
      - `context.bindingData?.claims?.sub`
      - `context.bindingData?.userId`
      - `context.triggerMetadata?.claims?.sub`
      - `context.triggerMetadata?.userId`
    - If no `userId` is present: returns early without error.
    - Computes `now = Date.now()`.
    - Calls `userHeartbeat(userId, now)` to record the timestamp in Redis.
    - Logs `"funcHeartbeat success"` with `{ userId }`.
  - Error handling:
    - Wraps the entire body in a `try/catch`.
    - On error: logs `"funcHeartbeat error"` as a **warning** and does **not** rethrow, so trigger failures do not crash the host.

### v4 implementation summary

- **Location**: `/backend-v4/functions/realtime/heartbeat.js`.
- **Trigger**: `socketiotrigger` via `app.generic` / `trigger.generic` (no HTTP route).
- **Azure Function name**: `RealtimeHeartbeat`.
- **Route**: _N/A_ (generic Socket.IO trigger, not HTTP-addressable).
- **Structure changes**:
  - Uses the v4 `app.generic` API with `trigger.generic({ type: "socketiotrigger", hub: "hub", eventName: "heartbeat" })`, following the official Web PubSub for Socket.IO serverless tutorial pattern.
  - Implements a named handler `realtimeHeartbeatHandler` that receives the raw trigger payload (ignored) and an `InvocationContext`.
  - Keeps logic focused on presence recording; no extra outputs are defined.
- **Logic**:
  - **User ID extraction**:
    - Replicates the v3 logic for pulling a user identifier from both `bindingData` and `triggerMetadata`:
      - `context.bindingData?.claims?.sub`.
      - `context.bindingData?.userId`.
      - `context.triggerMetadata?.claims?.sub`.
      - `context.triggerMetadata?.userId`.
    - If no `userId` is found, logs at a very low level (`verbose`/debug) and returns without error.
  - **Heartbeat recording**:
    - Computes `now = Date.now()`.
    - Calls `userHeartbeat(userId, now)` from `../../services/tayab/presence-service.js` to persist the heartbeat timestamp in Redis-backed presence.
    - Logs `"RealtimeHeartbeat success"` with `{ userId, now }`.
  - **Error handling**:
    - Wraps the entire handler body in `try/catch`.
    - On error: logs a warning (`"RealtimeHeartbeat error"`) and **does not rethrow**, preserving the non-fatal semantics of the v3 implementation.

### Trigger and binding changes

- **Original**:
  - Declared in `function.json` as a `socketiotrigger` with `hub: "hub"`, `eventName: "heartbeat"`, and no parameters.
  - Function entrypoint: default export receiving `(context)` and using `context.bindingData` / `context.triggerMetadata`.
- **New**:
  - Declared in code using v4 generic trigger API:

    ```js
    import { app, trigger } from "@azure/functions";

    async function realtimeHeartbeatHandler(_request, context) {
      // ... see implementation ...
    }

    app.generic("RealtimeHeartbeat", {
      trigger: trigger.generic({
        type: "socketiotrigger",
        hub: "hub",
        eventName: "heartbeat",
        parameterNames: [],
      }),
      handler: realtimeHeartbeatHandler,
    });
    ```

  - No HTTP trigger or route is defined; the function is invoked solely by Socket.IO `heartbeat` events from Web PubSub.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - The function continues to:
    - Extract `userId` from the same combination of `bindingData` and `triggerMetadata` fields.
    - Return early without error when `userId` is missing.
    - Call `userHeartbeat(userId, now)` with `now = Date.now()`.
    - Treat failures as non-fatal by logging and not rethrowing.
  - No changes to the Redis interaction or the semantics of what constitutes a heartbeat.
- **Differences / clarifications**:
  - The handler signature now receives an unused `_request` argument (the raw trigger payload) plus `context`; this is required by the v4 `app.generic` handler convention but does not change behavior.
  - Logging messages have been updated to use the `RealtimeHeartbeat` prefix for clarity and consistency with other v4 functions.
- **Edge cases**:
  - If the Socket.IO trigger is misconfigured and no `userId` claim is propagated, the function will simply log (at low level) and return without touching Redis.
  - If Redis is unavailable or `userHeartbeat` throws, the function logs a warning but does not crash the host or retry.

### Testing considerations

- **Integration tests** (optional, given this is an internal presence hook):
  - Use a test Socket.IO client connected via Web PubSub serverless mode.
  - Send a `heartbeat` event with a valid authenticated context / user claims.
  - Assert via a test helper on `presence-service` or Redis that `userHeartbeat(userId, now)` was invoked and a timestamp was recorded.
  - Verify that no HTTP route is exposed for this function; it should only respond to Socket.IO events.
- **Unit tests**:
  - Mock `userHeartbeat` and the `InvocationContext` to:
    - Verify that a valid `userId` leads to a single `userHeartbeat(userId, now)` call.
    - Verify that missing `userId` leads to an early return with no `userHeartbeat` call.
    - Verify that thrown errors are logged via `context.log.warn` and not rethrown.

### Known limitations / TODOs

- The function assumes that the upstream Web PubSub for Socket.IO configuration consistently attaches a `userId` (via claims or custom metadata) to heartbeat events.
- No rate limiting or throttling is applied; heartbeat frequency is governed entirely by the Socket.IO client behavior.
- Heartbeat timestamps are stored as opaque numeric values (milliseconds since epoch); any higher-level presence semantics (e.g. timeouts, grace periods) are implemented in `checkUserOnline` and related services, not in this function.
