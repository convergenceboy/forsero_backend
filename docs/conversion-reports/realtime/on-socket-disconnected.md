## RealtimeOnSocketDisconnected Conversion Report

### Function overview

- **Original name**: `tayab_funcOnSocketDisconnected`
- **Category**: `realtime` / Socket.IO presence & socket mapping
- **Purpose**: Handle Socket.IO `disconnected` events by removing the associated user socket mapping from Redis-backed storage.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcOnSocketDisconnected/index.js`
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
        "eventName": "disconnected"
      },
      {
        "type": "socketio",
        "direction": "out",
        "name": "socketOutput",
        "hub": "hub"
      }
    ]
  }
  ```
- **Behavior**:
  - Imports `deleteUserSocketId` from `../services/tayab/socket-map-service.js`.
  - On invocation:
    - Extracts `userId` from trigger metadata / binding data:
      - `context.bindingData?.claims?.sub`.
      - `context.bindingData?.userId`.
      - `context.triggerMetadata?.claims?.sub`.
      - `context.triggerMetadata?.userId`.
    - If `userId` is missing: returns early.
    - Calls `deleteUserSocketId(userId)` to remove the mapping from Redis.
    - Logs `"funcOnSocketDisconnected success"` with `{ userId }`.
  - Error handling:
    - Wraps the function in `try/catch`.
    - On error: logs `"funcOnSocketDisconnected error"` as a warning and does not rethrow.

### v4 implementation summary

- **Location**: `/backend-v4/functions/realtime/on-socket-disconnected.js`.
- **Trigger**: `socketiotrigger` via `app.generic` / `trigger.generic` (no HTTP route).
- **Azure Function name**: `RealtimeOnSocketDisconnected`.
- **Route**: _N/A_ (generic Socket.IO trigger, not HTTP-addressable).
- **Structure changes**:
  - Uses the v4 `app.generic` API with `trigger.generic({ type: "socketiotrigger", hub: "hub", eventName: "disconnected" })`.
  - Omits the unused Socket.IO output binding; this function only removes Redis mappings and does not send outbound messages.
  - Implements a named handler `realtimeOnSocketDisconnectedHandler` that receives the raw trigger payload (ignored) and an `InvocationContext`.
- **Logic**:
  - **User extraction**:
    - Replicates the v3 logic for `userId` using both `bindingData` and `triggerMetadata`.
    - If `userId` is missing: returns early without logging an error.
  - **Mapping removal**:
    - Calls `deleteUserSocketId(userId)` to delete the mapping.
    - Logs `"RealtimeOnSocketDisconnected success"` with `{ userId }`.
  - **Error handling**:
    - On error: logs `"RealtimeOnSocketDisconnected error"` as a warning and does not rethrow.

### Trigger and binding changes

- **Original**:
  - Trigger and bindings declared in `function.json` as shown above, including an unused Socket.IO output binding.
- **New**:
  - Declared in code using v4 generic trigger API:

    ```js
    import { app, trigger } from "@azure/functions";

    app.generic("RealtimeOnSocketDisconnected", {
      trigger: trigger.generic({
        type: "socketiotrigger",
        hub: "hub",
        eventName: "disconnected",
      }),
      handler: realtimeOnSocketDisconnectedHandler,
    });
    ```

### Behavioral changes and edge cases

- **Preserved behavior**:
  - The function continues to:
    - Listen to the `disconnected` event on the `hub` Socket.IO hub.
    - Extract `userId` from trigger metadata.
    - Ignore events with missing `userId`.
    - Remove the `(userId -> socketId)` mapping via `deleteUserSocketId`.
    - Treat failures as non-fatal by logging and not rethrowing.
- **Differences / clarifications**:
  - The unused Socket.IO output binding has been removed for simplicity; behavior is unchanged because the v3 code never wrote to `socketOutput`.
  - Logging prefixes now use `RealtimeOnSocketDisconnected`.
- **Edge cases**:
  - If the upstream Web PubSub / authentication pipeline does not attach a `userId`, no mapping is removed and no error is raised.

### Testing considerations

- **Integration tests**:
  - Connect and then disconnect a Socket.IO client via Web PubSub serverless mode and verify that the `(userId -> socketId)` mapping is removed from Redis.
- **Unit tests**:
  - Mock `deleteUserSocketId` and the `InvocationContext` to:
    - Verify that a valid `userId` leads to a single call to `deleteUserSocketId(userId)`.
    - Verify that missing `userId` results in an early return with no deletion.

### Known limitations / TODOs

- The function assumes that the upstream infrastructure correctly populates user claims; misconfiguration may leave stale mappings in Redis.
- Any higher-level presence semantics (e.g. multiple concurrent sockets per user) are handled in `socket-map-service` and related components, not in this function.
