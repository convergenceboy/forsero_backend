## RealtimeJoinRoom Conversion Report

### Function overview

- **Original name**: `tayab_funcJoinRoom`
- **Category**: `realtime` / Socket.IO messaging
- **Purpose**: Allow an authenticated user to "join" another user's room by sending a `room-join` Socket.IO event to the target user's active socket, subject to tenant and presence checks.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcJoinRoom/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Bindings**:
  - HTTP input (`req`) and HTTP output (`res`).
  - `socketio` output binding named `socketOutput`:
    - `hub: "hub"`.
- **Behavior**:
  - Resolves tenant using `resolveTenant(request)` and validates with `validateTenantAccess(tenant, "read")`:
    - On invalid tenant: returns `400` with `{ error: "Invalid tenant domain" }`.
    - On denied access: returns `403` with `{ error: "Tenant access denied" }`.
  - Extracts authentication context via `authRepository.extractAuthFromRequest(request)`:
    - On failure: returns `401` with `{ error: "Authentication required" }`.
  - Reads `toUserName` from `request.body` (assumed to be an object) and validates:
    - If missing: returns `400` with `{ error: "toUserName is required" }`.
  - Normalizes usernames:
    - `normalizedToUser = toUserName.trim().toLowerCase()`.
    - `normalizedFromUser = auth.username.trim().toLowerCase()`.
    - Prevents self-targeting: if equal, returns `400` with `{ error: "Cannot join your own room" }`.
  - Looks up the target user via `authRepository.getUserByUsername(tenant.id, normalizedToUser)`:
    - If not found: returns `404` with `{ error: "Target user not found" }`.
  - Reads the target user's socket ID from Redis via `getUserSocketId(Number.parseInt(toUser.id, 10))`:
    - If missing: returns `404` with `{ error: "Target user is not connected" }`.
  - Checks presence via `checkUserOnline(toUser.id)`:
    - If `online` is false: returns `404` with `{ error: "Target user is not online" }`.
  - Builds payload:
    - `fromUserName = normalizedFromUser || undefined`.
    - `payload = { fromUserName }`.
  - Writes to Socket.IO output binding:
    - `context.bindings.socketOutput = { actionName: "sendToSocket", eventName: "room-join", parameters: [payload], socketId: String(socketId) }`.
  - Logs `"funcJoinRoom success"` with details and returns `200` with `{ success: true }`.
  - On outer error: logs `"funcJoinRoom error"` and returns `500` with `{ error: "Internal server error" }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/realtime/join-room.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `RealtimeJoinRoom`.
- **Route**: `realtime/join-room` (invoked as `/api/realtime/join-room` by default).
- **Structure changes**:
  - Uses v4 `app.http` registration with handler `realtimeJoinRoomHandler`.
  - Uses a v4-style generic `socketio` output binding created with `output.generic(...)` and wired via `extraOutputs`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Adds non-fatal initialization via `initializeApp()`:
    - Called in a nested try/catch; logs a warning on failure and proceeds.
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
    - If equal: returns `400` with `{ error: "Cannot join your own room" }`.
  - Uses `authRepository.getUserByUsername(tenant.id, normalizedToUser)` to resolve the target user:
    - If not found: returns `404` with `{ error: "Target user not found" }`.
  - Uses `getUserSocketId(Number.parseInt(toUser.id, 10))` to fetch the target user's socket ID:
    - If missing: returns `404` with `{ error: "Target user is not connected" }`.
  - Uses `checkUserOnline(toUser.id)` to validate presence:
    - If `online` is false: returns `404` with `{ error: "Target user is not online" }`.
  - Builds the same payload and sends it through `context.extraOutputs.set(socketIOOutput, socketMessage)`:
    - `socketMessage = { actionName: "sendToSocket", eventName: "room-join", parameters: [payload], socketId: String(socketId) }`.
  - Logs `"RealtimeJoinRoom success"` with metadata and returns:
    - `200` with `{ success: true }` on success.
  - On outer error: logs `"Internal error in RealtimeJoinRoom"` and returns `500` with `{ error: "Internal server error" }`.

### Route and binding changes

- **Original**:
  - Route: implicitly `tayab_funcJoinRoom` (e.g. `/api/tayab_funcJoinRoom`).
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
  - Route: `realtime/join-room` (accessed as `/api/realtime/join-room`).
  - Binding: declared in code via generic output binding:

    ```js
    const socketIOOutput = output.generic({
      type: "socketio",
      direction: "out",
      name: "socketOutput",
      hub: "hub",
    });

    app.http("RealtimeJoinRoom", {
      methods: ["POST"],
      authLevel: "function",
      route: "realtime/join-room",
      extraOutputs: [socketIOOutput],
      handler: realtimeJoinRoomHandler,
    });
    ```

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and `validateTenantAccess(tenant, "read")` enforcement.
  - Requirement for JWT-based authentication and `401` on failures.
  - Input validation and normalization for `toUserName`.
  - Prevention of self-targeted room joins.
  - Target user lookup by username within the tenant, socket ID retrieval, and online presence validation.
  - Socket.IO message format and semantics (`actionName: "sendToSocket"`, `eventName: "room-join"`, payload with `fromUserName`).
  - Use of `404` for "not found / not connected / not online" scenarios with the same error messages.
  - `500` with `{ error: "Internal server error" }` on unexpected failures.
- **Differences / clarifications**:
  - The function now uses v4-style `request.json()` and header normalization; behavior is equivalent for JSON requests and standard headers.
  - Service initialization (`initializeApp()`) is now invoked but is non-fatal; this aligns join-room with other v4 functions without changing external behavior.
  - The HTTP route has been normalized to `realtime/join-room`; clients must be updated accordingly (client-v4 provides a typed wrapper).
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
  - Call `POST /api/realtime/join-room` with:
    - Headers:
      - `Authorization: Bearer <jwt for A>`.
      - `x-functions-key`, `x-tenant-domain`, `x-forsero-tenant-domain`.
    - Body: `{ "toUserName": "<B.username>" }`.
  - Assert:
    - `200` with `{ success: true }` on the HTTP response.
    - A corresponding `room-join` event delivered to the mocked Socket.IO binding for socket `<B.socketId>`.
  - Exercise error paths:
    - Missing `toUserName` → `400`.
    - Joining own room (same username) → `400`.
    - Nonexistent target user → `404` ("Target user not found").
    - No socket mapping or stale presence → `404` ("Target user is not connected"/"Target user is not online").
    - Invalid/missing token → `401`.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, `authRepository.getUserByUsername`, `getUserSocketId`, `checkUserOnline`, and `context.extraOutputs.set` to verify all branches and the exact payload sent to the Socket.IO binding.

### Known limitations / TODOs

- The function assumes that an external process (e.g. a connection handler function) is responsible for maintaining Redis socket mappings and heartbeats.
- Error responses are intentionally coarse-grained for privacy; more detailed diagnostics may be logged but not exposed to clients.
- Additional rate limiting (e.g. limiting join attempts per user per time window) could be added at the repository or service layer if abuse becomes a concern.
