## RealtimeSendChatRequest Conversion Report

### Function overview

- **Original name**: `tayab_funcSendChatRequest`
- **Category**: `realtime` / Socket.IO messaging
- **Purpose**: Send a `chat-request` Socket.IO event to a target user's active socket, subject to tenant, auth, connectivity, and presence checks, including optional encryption metadata.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcSendChatRequest/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Bindings**:
  - HTTP input (`req`) and HTTP output (`res`).
  - `socketio` output binding named `socketOutput` with `hub: "hub"`.
- **Behavior**:
  - Resolves tenant using `resolveTenant(request)` and validates with `validateTenantAccess(tenant, "read")`:
    - On invalid tenant: returns `400` with `{ error: "Invalid tenant domain" }`.
    - On denied access: returns `403` with `{ error: "Tenant access denied" }`.
  - Validates authentication via `authRepository.extractAuthFromRequest(request)`:
    - On failure: returns `401` with `{ error: "Authentication required" }`.
  - Extracts the request body as an object (defensive check) and reads `toUserName` and `encryptionData`.
  - Validates `toUserName`:
    - If missing: returns `400` with `{ error: "toUserName is required" }`.
  - Normalizes usernames:
    - `normalizedToUser = String(toUserName || "").trim().toLowerCase()`.
    - `normalizedFromUser = String(auth.username || "").trim().toLowerCase()`.
    - Prevents self-targeting: if equal, returns `400` with `{ error: "Cannot send a chat request to yourself" }`.
  - Looks up the target user via `authRepository.getUserByUsername(tenant.id, normalizedToUser)`:
    - If not found: returns `404` with `{ error: "Target user not found" }`.
  - Retrieves the target user's socket ID via `getUserSocketId(Number.parseInt(toUser.id, 10))`:
    - If missing: returns `404` with `{ error: "Target user is not connected" }`.
  - Checks presence via `checkUserOnline(toUser.id)`:
    - If `online` is false: returns `404` with `{ error: "Target user is not online" }`.
  - Builds payload:
    - `fromUserName = normalizedFromUser || undefined`.
    - `payload = { fromUserName, encryptionData }`.
  - Writes to the Socket.IO output binding:
    - `context.bindings.socketOutput = { actionName: "sendToSocket", eventName: "chat-request", parameters: [payload], socketId: String(toSocketId) }`.
  - Logs `"funcSendChatRequest success"` with `{ fromUserName, toUserName: normalizedToUser, toSocketId, encryptionData }`.
  - Returns `200` with `{ success: true }`.
  - On outer error: logs `"funcSendChatRequest error"` and returns `500` with `{ error: "Internal server error" }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/realtime/send-chat-request.js`.
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `RealtimeSendChatRequest`.
- **Route**: `realtime/send-chat-request` (invoked as `/api/realtime/send-chat-request` by default).
- **Structure changes**:
  - Uses v4 `app.http` registration with handler `realtimeSendChatRequestHandler`.
  - Uses a v4-style generic `socketio` output binding created with `output.generic(...)` and wired via `extraOutputs`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
  - Adds a non-fatal initialization step via `initializeApp()` to align with other v4 realtime functions.
- **Logic**:
  - **Initialization**:
    - Calls `initializeApp()` in a nested `try/catch`.
    - On failure: logs a warning (`Service initialization failed in RealtimeSendChatRequest`) and continues.
  - **Tenant resolution and access validation**:
    - Uses `resolveTenant(request)` and `validateTenantAccess(tenant, "read")`.
    - On invalid tenant: logs a warning and returns `400` with `{ error: "Invalid tenant domain" }`.
    - On denied access: returns `403` with `{ error: "Tenant access denied" }`.
  - **Authentication**:
    - Normalizes v4 `request.headers` (which may be a `Headers`-like object) into a plain object and calls `authRepository.extractAuthFromRequest({ headers })`.
    - On failure: logs a warning (`Authentication required for realtime send-chat-request`) and returns `401` with `{ error: "Authentication required" }`.
  - **Input parsing and validation**:
    - Reads JSON via `await request.json()` inside a `try/catch`, defaulting to `{}` on parse errors.
    - Extracts `toUserName` and `encryptionData`.
    - If `toUserName` is missing: returns `400` with `{ error: "toUserName is required" }`.
  - **Username normalization and self-targeting prevention**:
    - Normalizes `toUserName` and `auth.username` via `trim().toLowerCase()`.
    - If equal: returns `400` with `{ error: "Cannot send a chat request to yourself" }`.
  - **Target user lookup and connection checks**:
    - Uses `authRepository.getUserByUsername(tenant.id, normalizedToUser)` to find the target user.
    - If not found: returns `404` with `{ error: "Target user not found" }`.
    - Uses `getUserSocketId(Number.parseInt(toUser.id, 10))` to fetch the target user's socket ID.
      - If missing: returns `404` with `{ error: "Target user is not connected" }`.
    - Uses `checkUserOnline(toUser.id)` to validate presence.
      - If `online` is false: returns `404` with `{ error: "Target user is not online" }`.
  - **Event payload and binding**:
    - Constructs `fromUserName = normalizedFromUser || undefined`.
    - Builds `payload = { fromUserName, encryptionData }`.
    - Constructs `socketMessage = { actionName: "sendToSocket", eventName: "chat-request", parameters: [payload], socketId: String(toSocketId) }`.
    - Writes the message via `context.extraOutputs.set(socketIOOutput, socketMessage)`.
  - **Response and logging**:
    - Logs `"RealtimeSendChatRequest success"` with the same metadata as v3.
    - Returns `200` with `{ success: true }`.
  - **Error handling**:
    - On outer error: logs `"Internal error in RealtimeSendChatRequest"` and returns `500` with `{ error: "Internal server error" }`.

### Route and binding changes

- **Original**:
  - Route: implicitly `tayab_funcSendChatRequest` (e.g. `/api/tayab_funcSendChatRequest`).
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
  - Route: `realtime/send-chat-request` (accessed as `/api/realtime/send-chat-request`).
  - Binding: declared in code via generic output binding:

    ```js
    const socketIOOutput = output.generic({
      type: "socketio",
      direction: "out",
      name: "socketOutput",
      hub: "hub",
    });

    app.http("RealtimeSendChatRequest", {
      methods: ["POST"],
      authLevel: "function",
      route: "realtime/send-chat-request",
      extraOutputs: [socketIOOutput],
      handler: realtimeSendChatRequestHandler,
    });
    ```

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and `validateTenantAccess(tenant, "read")` enforcement.
  - Requirement for JWT-based authentication and `401` on failures.
  - Input validation and normalization for `toUserName`.
  - Prevention of self-targeted chat requests.
  - Target user lookup by username within the tenant, socket ID retrieval, and online presence validation.
  - Socket.IO message format and semantics (`actionName: "sendToSocket"`, `eventName: "chat-request"`, payload with `fromUserName` and `encryptionData`).
  - Use of `404` for "not found / not connected / not online" scenarios with the same error messages.
  - `500` with `{ error: "Internal server error" }` on unexpected failures.
- **Differences / clarifications**:
  - The function now uses v4-style `request.json()` and header normalization; behavior is equivalent for JSON requests and standard headers.
  - Service initialization (`initializeApp()`) is now invoked but is non-fatal; this aligns send-chat-request with other v4 functions without changing external behavior.
  - The HTTP route has been normalized to `realtime/send-chat-request`; clients must be updated accordingly (client-v4 provides a typed wrapper).
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
  - Call `POST /api/realtime/send-chat-request` with:
    - Headers:
      - `Authorization: Bearer <jwt for A>`.
      - `x-functions-key`, `x-tenant-domain`, `x-forsero-tenant-domain`.
    - Body: `{ "toUserName": "<B.username>", "encryptionData": { ... } }`.
  - Assert:
    - `200` with `{ success: true }` on the HTTP response.
    - A corresponding `chat-request` event delivered to the mocked Socket.IO binding for socket `<B.socketId>` with the expected payload.
  - Exercise error paths:
    - Missing `toUserName` → `400`.
    - Self-targeting (same username) → `400`.
    - Nonexistent target user → `404` ("Target user not found").
    - No socket mapping or stale presence → `404` ("Target user is not connected" / "Target user is not online").
    - Invalid/missing token → `401`.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, `authRepository.getUserByUsername`, `getUserSocketId`, `checkUserOnline`, and `context.extraOutputs.set` to verify all branches and the exact payload sent to the Socket.IO binding.

### Known limitations / TODOs

- The function assumes that an external process (e.g. connection/heartbeat handlers) maintains Redis socket mappings and heartbeats.
- Error responses are intentionally coarse-grained for privacy; more detailed diagnostics may be logged but are not exposed to clients.
- Encryption payload validation is not performed here; consumers are responsible for constructing a suitable `encryptionData` object.
