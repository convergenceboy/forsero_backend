## RealtimeOnSocketConnected Conversion Report

### Function overview

- **Original name**: `tayab_funcOnSocketConnected`
- **Category**: `realtime` / Socket.IO presence & socket mapping
- **Purpose**: Handle Socket.IO `connected` events by associating the authenticated user with a socket ID in Redis-backed socket mapping storage.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcOnSocketConnected/index.js`
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
        "eventName": "connected"
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
  - Imports `setUserSocketId` from `../services/tayab/socket-map-service.js`.
  - On invocation:
    - Extracts `socketId` from trigger metadata / binding data:
      - `context.bindingData?.socketId`.
      - `context.triggerMetadata?.socketId`.
    - If `socketId` is missing:
      - Logs a warning `"funcOnSocketConnected missing socketId in trigger data"` with binding/metadata keys and returns early.
    - Extracts `userId` from trigger metadata / binding data:
      - `context.bindingData?.claims?.sub`.
      - `context.bindingData?.userId`.
      - `context.triggerMetadata?.claims?.sub`.
      - `context.triggerMetadata?.userId`.
    - If `userId` is missing: returns early without logging an error.
    - Calls `setUserSocketId(userId, socketId)` to persist the mapping.
    - Logs `"funcOnSocketConnected success"` with `{ userId, socketId }`.
  - Error handling:
    - Wraps the function in `try/catch`.
    - On error: logs `"funcOnSocketConnected error"` as a warning and does not rethrow.

### v4 implementation summary

- **Location**: `/backend-v4/functions/realtime/on-socket-connected.js`.
- **Trigger**: `socketiotrigger` via `app.generic` / `trigger.generic` (no HTTP route).
- **Azure Function name**: `RealtimeOnSocketConnected`.
- **Route**: _N/A_ (generic Socket.IO trigger, not HTTP-addressable).
- **Structure changes**:
  - Uses the v4 `app.generic` API with `trigger.generic({ type: "socketiotrigger", hub: "hub", eventName: "connected" })`.
  - Omits the unused Socket.IO output binding; this function only updates Redis mappings and does not send outbound messages.
  - Implements a named handler `realtimeOnSocketConnectedHandler` that receives the raw trigger payload (ignored) and an `InvocationContext`.
- **Logic**:
  - **Socket and user extraction**:
    - Replicates the v3 logic for `socketId` and `userId` using both `bindingData` and `triggerMetadata`.
    - If `socketId` is missing: logs `"RealtimeOnSocketConnected missing socketId in trigger data"` with binding/metadata keys and returns early.
    - If `userId` is missing: returns early without logging an error.
  - **Mapping update**:
    - Calls `setUserSocketId(userId, socketId)` to record the mapping.
    - Logs `"RealtimeOnSocketConnected success"` with `{ userId, socketId }`.
  - **Error handling**:
    - On error: logs `"RealtimeOnSocketConnected error"` as a warning and does not rethrow.

### Trigger and binding changes

- **Original**:
  - Trigger and bindings declared in `function.json` as shown above, including an unused Socket.IO output binding.
- **New**:
  - Declared in code using v4 generic trigger API:

    ```js
    import { app, trigger } from "@azure/functions";

    app.generic("RealtimeOnSocketConnected", {
      trigger: trigger.generic({
        type: "socketiotrigger",
        hub: "hub",
        eventName: "connected",
      }),
      handler: realtimeOnSocketConnectedHandler,
    });
    ```

### Behavioral changes and edge cases

- **Preserved behavior**:
  - The function continues to:
    - Listen to the `connected` event on the `hub` Socket.IO hub.
    - Extract `socketId` and `userId` from trigger metadata.
    - Ignore events with missing `socketId` or `userId`.
    - Update the `(userId -> socketId)` mapping via `setUserSocketId`.
    - Treat failures as non-fatal by logging and not rethrowing.
- **Differences / clarifications**:
  - The unused Socket.IO output binding has been removed for simplicity; behavior is unchanged because the v3 code never wrote to `socketOutput`.
  - Logging prefixes now use `RealtimeOnSocketConnected`.
- **Edge cases**:
  - If the upstream Web PubSub / authentication pipeline does not attach a `userId`, no mapping is created and no error is raised.

### Testing considerations

- **Integration tests**:
  - Connect a Socket.IO client via Web PubSub serverless mode and verify that a `connected` event results in a `(userId -> socketId)` mapping being stored in Redis (via `socket-map-service`).
- **Unit tests**:
  - Mock `setUserSocketId` and the `InvocationContext` to:
    - Verify that valid `userId` and `socketId` lead to a single call with the correct arguments.
    - Verify that missing `socketId` or `userId` result in early returns and no mapping writes.

### Known limitations / TODOs

- The function assumes that the upstream infrastructure correctly populates `socketId` and user claims; misconfiguration may silently skip mapping creation.
- No cleanup is performed here; that responsibility remains with the corresponding `disconnected` handler.
