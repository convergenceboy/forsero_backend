## RealtimeLeaveRoom Conversion Report

### Function overview

- **Original name**: `tayab_funcLeaveRoom`
- **Category**: `realtime` / Socket.IO messaging
- **Purpose**: Allow an authenticated user to "leave" another user's room by sending a `room-leave` Socket.IO event to the target user's active socket, subject to tenant and presence checks.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcLeaveRoom/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Bindings**:
  - HTTP input (`req`) and HTTP output (`res`).
  - `socketio` output binding named `socketOutput`:
    - `hub: "hub"`.
- **Behavior**:
  - Resolves tenant using `resolveTenant(request)` and validates with `validateTenantAccess(tenant, "read")`:
    - On invalid tenant: sets `context.res = { status: 400, body: { error: "Invalid tenant domain" } }` and returns.
    - On denied access: sets `context.res = { status: 403, body: { error: "Tenant access denied" } }` and returns.
  - Extracts authentication context via `authRepository.extractAuthFromRequest(request)`:
    - On failure: sets `context.res = { status: 401, body: { error: "Authentication required" } }` and returns.
  - Reads `toUserName` from `request.body` (assumed to be an object) and validates:
    - If missing: sets `context.res = { status: 400, body: { error: "toUserName is required" } }` and returns.
  - Normalizes usernames:
    - `normalizedToUser = toUserName.trim().toLowerCase()`.
    - `normalizedFromUser = auth.username.trim().toLowerCase()`.
    - Prevents self-targeting: if equal, sets `context.res = { status: 400, body: { error: "Cannot leave your own room" } }` and returns.
  - Looks up the target user via `authRepository.getUserByUsername(tenant.id, normalizedToUser)`:
    - If not found: sets `context.res = { status: 404, body: { error: "Target user not found" } }` and returns.
  - Reads the target user's socket ID from Redis via `getUserSocketId(Number.parseInt(toUser.id, 10))`:
    - If missing: sets `context.res = { status: 404, body: { error: "Target user is not connected" } }` and returns.
  - Checks presence via `checkUserOnline(toUser.id)`:
    - If `online` is false: sets `context.res = { status: 404, body: { error: "Target user is not online" } }` and returns.
  - Builds payload:
    - `fromUserName = normalizedFromUser || undefined`.
    - `payload = { fromUserName }`.
  - Writes to Socket.IO output binding:
    - `context.bindings.socketOutput = { actionName: "sendToSocket", eventName: "room-leave", parameters: [payload], socketId: String(socketId) }`.
  - Logs `"funcLeaveRoom success"` with details and returns `200` with `{ success: true }`.
  - On outer error: logs `"funcLeaveRoom error"` and returns `500` with `{ error: "Internal server error" }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/realtime/leave-room.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `RealtimeLeaveRoom`.
- **Route**: `realtime/leave-room` (invoked as `/api/realtime/leave-room` by default).
- **Structure changes**:
  - Uses v4 `app.http` registration with handler `realtimeLeaveRoomHandler`.
  - Uses a v4-style generic `socketio` output binding created with `output.generic(...)` and wired via `extraOutputs`, following the Web PubSub for Socket.IO serverless pattern described in the Azure tutorial ([Tutorial: Build chat app with Azure Function in Serverless Mode](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/socket-io-serverless-tutorial?tabs=storage-azurite&utm_source=chatgpt.com)).
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Adds non-fatal initialization via `initializeApp()`:
    - Called in a nested try/catch; logs a warning on failure and proceeds, aligning with other v4 auth/realtime functions.
  - Preserves tenant resolution and access validation:
    - Uses `resolveTenant(request)` and `validateTenantAccess(tenant, "read")`.
    - On invalid/denied tenant: returns `400` (`Invalid tenant domain`) or `403` (`Tenant access denied`) with the same messages as v3.
  - Preserves authentication behavior:
    - Normalizes v4 `request.headers` (which may be a `Headers`-like object) into a plain `{ headers: ... }` shape for `authRepository.extractAuthFromRequest`.
    - On failure: logs a warning and returns `401` with `{ error: "Authentication required" }`.
  - Reads and validates `toUserName` from `await request.json()`:
    - On parse failure: treats body as `{}` and falls back to validation.
    - If missing: returns `400` with `{ error: "toUserName is required" }`.
  - Normalizes usernames and prevents self-targeting exactly as in v3:
    - `normalizedToUser` and `normalizedFromUser` derived via `trim().toLowerCase()`.
    - If equal: returns `400` with `{ error: "Cannot leave your own room" }`.
  - Uses `authRepository.getUserByUsername(tenant.id, normalizedToUser)` to resolve the target user:
    - If not found: returns `404` with `{ error: "Target user not found" }`.
  - Uses `getUserSocketId(Number.parseInt(toUser.id, 10))` to fetch the target user's socket ID:
    - If missing: returns `404` with `{ error: "Target user is not connected" }`.
  - Uses `checkUserOnline(toUser.id)` to validate presence:
    - If `online` is false: returns `404` with `{ error: "Target user is not online" }`.
  - Builds the same payload and sends it through `context.extraOutputs.set(socketIOOutput, socketMessage)`:
    - `socketMessage = { actionName: "sendToSocket", eventName: "room-leave", parameters: [payload], socketId: String(socketId) }`.
  - Logs `"RealtimeLeaveRoom success"` with metadata and returns:
    - `200` with `{ success: true }` on success.
  - On outer error: logs `"Internal error in RealtimeLeaveRoom"` and returns `500` with `{ error: "Internal server error" }`.

### Route and binding changes

- **Original**:
  - Route: implicitly `tayab_funcLeaveRoom` (e.g. `/api/tayab_funcLeaveRoom`).
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
  - Route: `realtime/leave-room` (accessed as `/api/realtime/leave-room`).
  - Binding: declared in code via generic output binding:

    ```js
    const socketIOOutput = output.generic({
      type: "socketio",
      direction: "out",
      name: "socketOutput",
      hub: "hub",
    });

    app.http("RealtimeLeaveRoom", {
      methods: ["POST"],
      authLevel: "function",
      route: "realtime/leave-room",
      extraOutputs: [socketIOOutput],
      handler: realtimeLeaveRoomHandler,
    });
    ```

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and `validateTenantAccess(tenant, "read")` enforcement.
  - Requirement for JWT-based authentication and `401` on failures.
  - Input validation and normalization for `toUserName`.
  - Prevention of self-targeted room leaves.
  - Target user lookup by username within the tenant, socket ID retrieval, and online presence validation.
  - Socket.IO message format and semantics (`actionName: "sendToSocket"`, `eventName: "room-leave"`, payload with `fromUserName`).
  - Use of `404` for "not found / not connected / not online" scenarios with the same error messages.
  - `500` with `{ error: "Internal server error" }` on unexpected failures.
- **Differences / clarifications**:
  - The function now uses v4-style `request.json()` and header normalization; behavior is equivalent for JSON requests and standard headers.
  - Service initialization (`initializeApp()`) is now invoked but is non-fatal; this aligns `leave-room` with other v4 functions without changing external behavior.
  - The HTTP route has been normalized to `realtime/leave-room`; clients must be updated accordingly (client-v4 provides a typed wrapper).
- **Edge cases**:
  - If Redis is unavailable or `getUserSocketId` / `checkUserOnline` reject, the function will log and return a generic `500` internal error.
  - If the JWT is valid but `auth.username` is missing, `fromUserName` will be `undefined` in the payload, which is consistent with the v3 behavior when username normalization fails.

### Testing considerations

- **Integration tests should**:
  - Use the passwordless auth flow to:
    - Register at least two users with usernames `A` and `B`.
    - Authenticate as one of them to obtain a JWT and `user_id`.
  - Simulate the target user `B` being connected and online:
    - Ensure Redis has a mapping `userIdToSocketId:<B.id>` with a test socket ID.
    - Ensure `userHeartbeat(B.id)` has been called recently so `checkUserOnline` returns `online: true`.
  - Call `POST /api/realtime/leave-room` with:
    - Headers:
      - `Authorization: Bearer <jwt for A>`.
      - `x-functions-key`, `x-tenant-domain`, `x-forsero-tenant-domain`.
    - Body: `{ "toUserName": "<B.username>" }`.
  - Assert:
    - `200` with `{ success: true }` on the HTTP response.
    - A corresponding `room-leave` event delivered to the mocked Socket.IO binding for socket `<B.socketId>`.
  - Exercise error paths:
    - Missing `toUserName` → `400`.
    - Leaving own room (same username) → `400`.
    - Nonexistent target user → `404` ("Target user not found").
    - No socket mapping or stale presence → `404` ("Target user is not connected"/"Target user is not online").
    - Invalid/missing token → `401`.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, `authRepository.getUserByUsername`, `getUserSocketId`, `checkUserOnline`, and `context.extraOutputs.set` to verify all branches and the exact payload sent to the Socket.IO binding.

### Known limitations / TODOs

- The function assumes that an external process (e.g. a connection handler function) is responsible for maintaining Redis socket mappings and heartbeats.
- Error responses are intentionally coarse-grained for privacy; more detailed diagnostics may be logged but not exposed to clients.
- Additional rate limiting (e.g. limiting leave attempts per user per time window) could be added at the repository or service layer if abuse becomes a concern.
