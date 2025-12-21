## RealtimeCheckUserOnline Conversion Report

### Function overview

- **Original name**: `tayab_funcCheckUserOnline`
- **Category**: `realtime` / presence
- **Purpose**: Check whether a given user is considered "online" according to Redis-backed heartbeat presence.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcCheckUserOnline/index.js`
- **Trigger**: HTTP (`httpTrigger`, methods: `GET`, `POST`, `authLevel: function`).
- **Bindings**:
  - HTTP input (`req`) and HTTP output (`res`).
- **Behavior**:
  - Resolves tenant using `resolveTenant(request)` and validates with `validateTenantAccess(tenant, "read")`:
    - On invalid tenant: returns `400` with `{ error: "Invalid tenant domain" }`.
    - On denied access: returns `403` with `{ error: "Tenant access denied" }`.
  - Validates authentication via `authRepository.extractAuthFromRequest(request)`:
    - On failure: returns `401` with `{ error: "Authentication required" }`.
  - Extracts `userName` from `request.body` (object-safe check):
    - On missing value: returns `400` with `{ error: "userName is required" }`.
  - Resolves the user by normalized username:
    - `normalizedUserName = String(userName || "").trim().toLowerCase()`.
    - Calls `authRepository.getUserByUsername(tenant.id, normalizedUserName)`.
    - If user not found or lookup fails: returns `200` with `{ online: false, lastHeartbeat: null }`.
  - When user is found:
    - Uses `checkUserOnline(userId, 10_000)` to determine presence.
    - Logs `"funcCheckUserOnline success"` with `{ userId, online, lastHeartbeat }`.
    - Returns `200` with `{ online, lastHeartbeat }`.
  - On outer error:
    - Logs `"funcCheckUserOnline error"` and returns `500` with `{ error: "Internal server error" }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/realtime/check-user-online.js`
- **Trigger**: HTTP (via `app.http`, methods: `GET`, `POST`, `authLevel: function`).
- **Azure Function name**: `RealtimeCheckUserOnline`.
- **Route**: `realtime/check-user-online` (invoked as `/api/realtime/check-user-online` by default).
- **Structure changes**:
  - Uses v4 `app.http` registration with handler `realtimeCheckUserOnlineHandler`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
  - Adds a non-fatal initialization step via `initializeApp()` consistent with other v4 functions.
- **Logic**:
  - **Initialization**:
    - Calls `initializeApp()` in a nested `try/catch`.
    - On failure: logs a warning (`Service initialization failed in RealtimeCheckUserOnline`) and continues without aborting.
  - **Tenant resolution and access validation**:
    - Uses `resolveTenant(request)` and `validateTenantAccess(tenant, "read")`.
    - On invalid tenant: logs a warning and returns `400` with `{ error: "Invalid tenant domain" }`.
    - On denied access: returns `403` with `{ error: "Tenant access denied" }`.
  - **Authentication**:
    - Normalizes v4 `request.headers` (which may be a `Headers`-like object) into a plain object for `authRepository.extractAuthFromRequest({ headers })`.
    - On failure: logs a warning (`Authentication required for realtime check-user-online`) and returns `401` with `{ error: "Authentication required" }`.
  - **Input parsing and validation**:
    - Reads JSON body via `await request.json()` inside a `try/catch`, defaulting to `{}` on parse errors.
    - Supports both `userName` (legacy) and `username` (forward-compatible) fields.
    - If neither is provided: returns `400` with `{ error: "userName is required" }` to match the original contract.
  - **User resolution**:
    - Normalizes the chosen username exactly as in v3: `trim().toLowerCase()`.
    - Calls `authRepository.getUserByUsername(tenant.id, normalizedUserName)`.
    - On missing user: logs an informational message and returns `200` with `{ online: false, lastHeartbeat: null }`.
    - On lookup error: logs a warning and also returns `200` with `{ online: false, lastHeartbeat: null }`.
  - **Presence check**:
    - Calls `checkUserOnline(userId, 10_000)` from the shared Redis-backed presence service.
    - Logs `"RealtimeCheckUserOnline success"` with `{ userId, online, lastHeartbeat }`.
    - Returns `200` with `{ online, lastHeartbeat }`.
  - **Error handling**:
    - On outer error: logs `"Internal error in RealtimeCheckUserOnline"` and returns `500` with `{ error: "Internal server error" }`.

### Route and binding changes

- **Original**:
  - Route: implicitly `tayab_funcCheckUserOnline` (e.g. `/api/tayab_funcCheckUserOnline`).
  - Bindings (from `function.json`):
    ```json
    {
      "bindings": [
        {
          "authLevel": "function",
          "type": "httpTrigger",
          "direction": "in",
          "name": "req",
          "methods": ["get", "post"]
        },
        {
          "type": "http",
          "direction": "out",
          "name": "res"
        }
      ]
    }
    ```
- **New**:
  - Route: `realtime/check-user-online` (accessed as `/api/realtime/check-user-online`).
  - Binding: declared in code via v4 `app.http` registration:
    ```js
    app.http("RealtimeCheckUserOnline", {
      methods: ["GET", "POST"],
      authLevel: "function",
      route: "realtime/check-user-online",
      handler: realtimeCheckUserOnlineHandler,
    });
    ```

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and enforcement of `validateTenantAccess(tenant, "read")`.
  - Authentication requirement, returning `401` with `{ error: "Authentication required" }` on failure.
  - Username normalization with `trim().toLowerCase()`.
  - The presence semantics: user-not-found and lookup errors both result in `200` with `{ online: false, lastHeartbeat: null }`.
  - Use of `checkUserOnline(userId, 10_000)` from the shared presence service.
  - `500` with `{ error: "Internal server error" }` on unexpected outer failures.
- **Differences / clarifications**:
  - The v4 implementation accepts either `userName` or `username` in the JSON body; this is backwards compatible for existing callers relying on `userName`.
  - Logging messages have been renamed to `RealtimeCheckUserOnline ...` but carry equivalent diagnostic information.
  - Initialization via `initializeApp()` has been added to align with other v4 functions, but failures remain non-fatal.
  - The HTTP route has been normalized under the `realtime` namespace; client-v4 provides a typed wrapper to hide this change from consumers.
- **Edge cases**:
  - If Redis is unavailable or `checkUserOnline` throws, the function logs an error and returns `500` with `{ error: "Internal server error" }`.
  - If the username normalizes to an empty string, the function treats it as missing and returns `400` with `userName is required`.

### Testing considerations

- **Integration tests should**:
  - Use the passwordless auth flow to create and authenticate a user, obtaining a JWT and username.
  - Optionally simulate heartbeat activity via the `heartbeat` event/function so that `checkUserOnline` returns `online: true` for the test user.
  - Call `POST /api/realtime/check-user-online` with:
    - Headers:
      - `Authorization: Bearer <jwt>`.
      - `x-functions-key: <function key>` (if required).
      - `x-tenant-domain` and `x-forsero-tenant-domain`.
    - Body: `{ "userName": "<username>" }` or `{ "username": "<username>" }`.
  - Verify:
    - HTTP `200`.
    - Body with shape `{ online: boolean, lastHeartbeat: number | null }`.
  - Exercise error paths:
    - Missing username → `400` with `{ error: "userName is required" }`.
    - Invalid tenant headers → `400`/`403`.
    - Invalid/missing auth → `401`.
- **Unit tests can**:
  - Mock `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, `authRepository.getUserByUsername`, and `checkUserOnline` to cover:
    - User-not-found and lookup-error cases returning `online: false`.
    - Online/offline responses from `checkUserOnline`.
    - Proper logging and status codes for all code paths.

### Known limitations / TODOs

- The function deliberately does not distinguish between "user not found" and "offline" in its public API beyond the `online` flag.
- Rate limiting for presence checks is not implemented here and would need to be addressed at a higher layer if necessary.
- The function assumes that heartbeats are being recorded elsewhere (e.g. by a separate heartbeat event handler tied to Web PubSub / Socket.IO events).
