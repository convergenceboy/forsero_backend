## RealtimeAckChatRequest Conversion Report

### Function overview

- **Original name**: `tayab_funcAckChatRequest`
- **Category**: `realtime` / Socket.IO messaging
- **Purpose**: Acknowledge a chat request by sending a `chat-request-ack` Socket.IO event to a target user's active socket, subject to tenant, auth, connectivity, and presence checks.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcAckChatRequest/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Bindings**:
  - HTTP input (`req`) and HTTP output (`res`).
  - `socketio` output binding named `socketOutput` with `hub: "hub"`.
- **Behavior**:
  - Resolves tenant using `resolveTenant(request)` and validates with `validateTenantAccess(tenant, "read")`:
    - On invalid tenant: sets `context.res = { status: 400, body: { error: "Invalid tenant domain" } }` and returns.
    - On denied access: sets `context.res = { status: 403, body: { error: "Tenant access denied" } }` and returns.
  - Validates authentication via `authRepository.extractAuthFromRequest(request)`:
    - On failure: sets `context.res = { status: 401, body: { error: "Authentication required" } }` and returns.
  - Extracts the request body as an object defensively and reads `toUserName`.
  - Validates `toUserName`:
    - If missing: sets `context.res = { status: 400, body: { error: "toUserName is required" } }` and returns.
  - Normalizes usernames:
    - `normalizedToUser = String(toUserName || "").trim().toLowerCase()`.
    - `normalizedFromUser = String(auth.username || "").trim().toLowerCase()`.
  - Looks up the target user via `authRepository.getUserByUsername(tenant.id, normalizedToUser)`:
    - If not found: sets `context.res = { status: 404, body: { error: "Target user not found" } }` and returns.
  - Retrieves the target user's socket ID via `getUserSocketId(Number.parseInt(toUser.id, 10))`:
    - If missing: sets `context.res = { status: 404, body: { error: "Target user is not connected" } }` and returns.
  - Checks presence via `checkUserOnline(toUser.id)`:
    - If `online` is false: sets `context.res = { status: 404, body: { error: "Target user is not online" } }` and returns.
  - Builds payload:
    - `fromUserName = normalizedFromUser || undefined`.
    - `payload = { fromUserName }`.
  - Writes to the Socket.IO output binding:
    - `context.bindings.socketOutput = { actionName: "sendToSocket", eventName: "chat-request-ack", parameters: [payload], socketId: String(socketId) }`.
  - Logs `"funcAckChatRequest success"` with `{ fromUserName, toUserName: normalizedToUser, socketId }`.
  - Sets `context.res = { status: 200, body: { success: true } }`.
  - On outer error: logs `"funcAckChatRequest error"` and sets `context.res = { status: 500, body: { error: "Internal server error" } }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/realtime/ack-chat-request.js`.
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `RealtimeAckChatRequest`.
- **Route**: `realtime/ack-chat-request` (invoked as `/api/realtime/ack-chat-request` by default).
- **Structure changes**:
  - Uses v4 `app.http` registration with handler `realtimeAckChatRequestHandler`.
  - Uses a v4-style generic `socketio` output binding created with `output.generic(...)` and wired via `extraOutputs`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
  - Adds a non-fatal initialization step via `initializeApp()` to align with other v4 realtime functions.
- **Logic**:
  - **Initialization**:
    - Calls `initializeApp()` in a nested `try/catch`.
    - On failure: logs a warning (`Service initialization failed in RealtimeAckChatRequest`) and continues.
  - **Tenant resolution and access validation**:
    - Uses `resolveTenant(request)` and `validateTenantAccess(tenant, "read")`.
    - On invalid tenant: logs a warning and returns `400` with `{ error: "Invalid tenant domain" }`.
    - On denied access: returns `403` with `{ error: "Tenant access denied" }`.
  - **Authentication**:
    - Normalizes v4 `request.headers` (which may be a `Headers`-like object) into a plain object and calls `authRepository.extractAuthFromRequest({ headers })`.
    - On failure: logs a warning (`Authentication required for realtime ack-chat-request`) and returns `401` with `{ error: "Authentication required" }`.
  - **Input parsing and validation**:
    - Reads JSON via `await request.json()` inside a `try/catch`, defaulting to `{}` on parse errors.
    - Extracts `toUserName`.
    - If `toUserName` is missing: returns `400` with `{ error: "toUserName is required" }`.
  - **Username normalization**:
    - Normalizes `toUserName` and `auth.username` via `trim().toLowerCase()`.
    - Note: unlike send/reject/cancel, the original ack implementation did **not** prevent self-targeting, so no additional self-targeting guard was introduced in v4 to preserve behavior.
  - **Target user lookup and connection checks**:
    - Uses `authRepository.getUserByUsername(tenant.id, normalizedToUser)` to find the target user.
    - If not found: returns `404` with `{ error: "Target user not found" }`.
    - Uses `getUserSocketId(Number.parseInt(toUser.id, 10))` to fetch the target user's socket ID.
      - If missing: returns `404` with `{ error: "Target user is not connected" }`.
    - Uses `checkUserOnline(toUser.id)` to validate presence.
      - If `online` is false: returns `404` with `{ error: "Target user is not online" }`.
  - **Event payload and binding**:
    - Constructs `fromUserName = normalizedFromUser || undefined`.
    - Builds `payload = { fromUserName }`.
    - Constructs `socketMessage = { actionName: "sendToSocket", eventName: "chat-request-ack", parameters: [payload], socketId: String(toSocketId) }`.
    - Writes the message via `context.extraOutputs.set(socketIOOutput, socketMessage)`.
  - **Response and logging**:
    - Logs `"RealtimeAckChatRequest success"` with `{ fromUserName, toUserName: normalizedToUser, toSocketId }`.
    - Returns `200` with `{ success: true }`.
  - **Error handling**:
    - On outer error: logs `"Internal error in RealtimeAckChatRequest"` and returns `500` with `{ error: "Internal server error" }`.

### Route and binding changes

- **Original**:
  - Route: implicitly `tayab_funcAckChatRequest` (e.g. `/api/tayab_funcAckChatRequest`).
  - Bindings (from `function.json`):
    ```json
    {
      "bindings": [
        {
          "authLevel": "function",
          "type": "httpTrigger",
          "direction": "in",
          "name": "req",
          "methods": ["post"]
        },
        {
          "type": "http",
          "direction": "out",
          "name": "res"
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
- **New**:
  - Route: `realtime/ack-chat-request` (accessed as `/api/realtime/ack-chat-request`).
  - Binding: declared in code via generic output binding:

    ```js
    const socketIOOutput = output.generic({
      type: 'socketio',
      direction: 'out',
      name: 'socketOutput',
      hub: 'hub',
    });

    app.http('RealtimeAckChatRequest', {
      methods: ['POST'],
      authLevel: 'function',
      route: 'realtime/ack-chat-request',
      extraOutputs: [socketIOOutput],
      handler: realtimeAckChatRequestHandler,
    });
    ```

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and `validateTenantAccess(tenant, "read")` enforcement.
  - Requirement for JWT-based authentication and `401` on failures.
  - Input validation and normalization for `toUserName`.
  - Target user lookup by username within the tenant, socket ID retrieval, and online presence validation.
  - Socket.IO message format and semantics (`actionName: "sendToSocket"`, `eventName: "chat-request-ack"`, payload with `fromUserName`).
  - Use of `404` for "not found / not connected / not online" scenarios with the same error messages.
  - `500` with `{ error: "Internal server error" }` on unexpected failures.
- **Differences / clarifications**:
  - The function now uses v4-style `request.json()` and header normalization; behavior is equivalent for JSON requests and standard headers.
  - Service initialization (`initializeApp()`) is now invoked but is non-fatal; this aligns ack-chat-request with other v4 realtime functions without changing external behavior.
  - The HTTP route has been normalized to `realtime/ack-chat-request`; clients should call this via the client-v4 wrapper.
- **Edge cases**:
  - If Redis is unavailable or `getUserSocketId` / `checkUserOnline` reject, the function will log and return a generic `500` internal error.
  - If the JWT is valid but `auth.username` is missing, `fromUserName` will be `undefined` in the payload, which is consistent with v3 behavior when username normalization fails.

### Testing considerations

- **Integration tests should**:
  - Use the passwordless auth flow to:
    - Register at least two users with usernames `A` and `B`.
    - Authenticate as user A to obtain a JWT.
  - Simulate the target user `B` being connected and online:
    - Ensure Redis has a mapping from `userId` to socket ID for B.
    - Ensure `userHeartbeat(B.id)` has been called recently so `checkUserOnline` returns `online: true`.
  - Call `POST /api/realtime/ack-chat-request` with:
    - Headers:
      - `Authorization: Bearer <jwt for A>`.
      - `x-functions-key`, `x-tenant-domain`, `x-forsero-tenant-domain`.
    - Body: `{ "toUserName": "<B.username>" }`.
  - Assert:
    - `200` with `{ success: true }` on the HTTP response.
    - A corresponding `chat-request-ack` event delivered to the mocked Socket.IO binding for socket `<B.socketId>` with the expected payload.
  - Exercise error paths:
    - Missing `toUserName` → `400`.
    - Nonexistent target user → `404` ("Target user not found").
    - No socket mapping or stale presence → `404` ("Target user is not connected" / "Target user is not online").
    - Invalid/missing token → `401`.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, `authRepository.getUserByUsername`, `getUserSocketId`, `checkUserOnline`, and `context.extraOutputs.set` to verify all branches and the exact payload sent to the Socket.IO binding.

### Known limitations / TODOs

- The function assumes that an external process (e.g. connection/heartbeat handlers) maintains Redis socket mappings and heartbeats.
- Error responses are intentionally coarse-grained for privacy; more detailed diagnostics may be logged but are not exposed to clients.
- No additional payload (e.g. encryption metadata or reason text) is attached to the `chat-request-ack` event beyond the originating username; any richer semantics should be implemented in higher-level application logic.
