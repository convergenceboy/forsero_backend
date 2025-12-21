## RealtimeGetAssociatedSocketId Conversion Report

### Function overview

- **Original name**: `tayab_funcGetAssociatedSocketId`
- **Category**: `realtime` / presence & connections
- **Purpose**: Return the Socket.IO connection ID associated with the authenticated user, if any, using the Redis-backed socket map.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcGetAssociatedSocketId/index.js`
- **Trigger**: HTTP (`httpTrigger`, methods: `GET`, `POST`, `authLevel: function`).
- **Bindings**:
  - HTTP input (`req`) and HTTP output (`res`).
- **Behavior**:
  - Resolves tenant using `resolveTenant(request)` and validates with `validateTenantAccess(tenant, "read")`:
    - On invalid tenant: returns `400` with `{ error: "Invalid tenant domain" }`.
    - On denied access: returns `403` with `{ error: "Tenant access denied" }`.
  - Validates authentication via `authRepository.extractAuthFromRequest(request)`:
    - On failure: returns `401` with `{ error: "Authentication required" }`.
  - Derives the user ID from the auth context:
    - `userId = Number.parseInt(auth.user_id, 10)`.
    - If falsy: returns `400` with `{ error: "Invalid user id" }`.
  - Looks up the user's socket ID via `getUserSocketId(userId)`.
  - Logs `"funcGetAssociatedSocketId success"` with `{ userId, socketId }`.
  - Returns `200` with `{ userId, socketId: socketId || null }`.
  - On outer error:
    - Logs `"funcGetAssociatedSocketId error"` and returns `500` with `{ error: "Internal server error" }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/realtime/get-associated-socket-id.js`
- **Trigger**: HTTP (via `app.http`, methods: `GET`, `POST`, `authLevel: function`).
- **Azure Function name**: `RealtimeGetAssociatedSocketId`.
- **Route**: `realtime/get-associated-socket-id` (invoked as `/api/realtime/get-associated-socket-id` by default).
- **Structure changes**:
  - Uses v4 `app.http` registration with handler `realtimeGetAssociatedSocketIdHandler`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
  - Adds a non-fatal initialization step via `initializeApp()` to align with other v4 realtime functions.
- **Logic**:
  - **Initialization**:
    - Calls `initializeApp()` in a nested `try/catch`.
    - On failure: logs a warning (`Service initialization failed in RealtimeGetAssociatedSocketId`) and continues.
  - **Tenant resolution and access validation**:
    - Uses `resolveTenant(request)` and `validateTenantAccess(tenant, "read")`.
    - On invalid tenant: logs a warning and returns `400` with `{ error: "Invalid tenant domain" }`.
    - On denied access: returns `403` with `{ error: "Tenant access denied" }`.
  - **Authentication**:
    - Normalizes v4 `request.headers` (which may be a `Headers`-like object) into a plain object and calls `authRepository.extractAuthFromRequest({ headers })`.
    - On failure: logs a warning (`Authentication required for realtime get-associated-socket-id`) and returns `401` with `{ error: "Authentication required" }`.
  - **User ID resolution**:
    - Derives `userId` from `auth.user_id` using `Number.parseInt(auth?.user_id, 10)`.
    - If falsy: returns `400` with `{ error: "Invalid user id" }`.
  - **Socket lookup**:
    - Calls `getUserSocketId(userId)` from the shared socket map service (Redis-backed).
    - Logs `"RealtimeGetAssociatedSocketId success"` with `{ userId, socketId }`.
    - Returns `200` with `{ userId, socketId: socketId || null }`.
  - **Error handling**:
    - On outer error: logs `"Internal error in RealtimeGetAssociatedSocketId"` and returns `500` with `{ error: "Internal server error" }`.

### Route and binding changes

- **Original**:
  - Route: implicitly `tayab_funcGetAssociatedSocketId` (e.g. `/api/tayab_funcGetAssociatedSocketId`).
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
  - Route: `realtime/get-associated-socket-id` (accessed as `/api/realtime/get-associated-socket-id`).
  - Binding: declared in code via v4 `app.http` registration:
    ```js
    app.http("RealtimeGetAssociatedSocketId", {
      methods: ["GET", "POST"],
      authLevel: "function",
      route: "realtime/get-associated-socket-id",
      handler: realtimeGetAssociatedSocketIdHandler,
    });
    ```

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and enforcement of `validateTenantAccess(tenant, "read")`.
  - Authentication requirement, returning `401` with `{ error: "Authentication required" }` on failure.
  - User ID derivation from `auth.user_id` and `400` with `{ error: "Invalid user id" }` when missing/invalid.
  - Socket lookup semantics via `getUserSocketId(userId)` and returning `socketId || null`.
  - `500` with `{ error: "Internal server error" }` on unexpected failures.
- **Differences / clarifications**:
  - The v4 function now performs best-effort `initializeApp()` to be consistent with other realtime endpoints; this does not change external behavior.
  - Logging prefixes have been updated from `funcGetAssociatedSocketId` to `RealtimeGetAssociatedSocketId` but carry equivalent information.
  - The HTTP route is now namespaced under `realtime`; the v4 client library abstracts this for consumers.
- **Edge cases**:
  - If Redis is unavailable or `getUserSocketId` throws, the function logs the error and returns `500` with a generic internal error message.
  - If the authentication context does not include a parseable `user_id`, callers receive `400 Invalid user id` even if the JWT is otherwise structurally valid.

### Testing considerations

- **Integration tests should**:
  - Use the passwordless auth flow to register and authenticate a user, obtaining a JWT and `user_id`.
  - (Optionally) establish a realtime connection so that Redis contains a socket mapping for the test user.
  - Call `GET /api/realtime/get-associated-socket-id` with:
    - Headers:
      - `Authorization: Bearer <jwt>`.
      - `x-functions-key: <function key>` (if required).
      - `x-tenant-domain` and `x-forsero-tenant-domain`.
  - Verify:
    - HTTP `200`.
    - Response body `{ userId: number, socketId: string | null }`.
  - Exercise error paths:
    - Missing/invalid tenant headers → `400`/`403`.
    - Missing/invalid auth → `401`.
    - Manipulated auth context missing `user_id` → `400` with `Invalid user id`.
- **Unit tests can**:
  - Mock `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, and `getUserSocketId` to cover all branches, including:
    - Valid vs. invalid user IDs.
    - Null vs. non-null socket IDs.
    - Thrown errors from the socket map service.

### Known limitations / TODOs

- The function intentionally does not attempt to infer or correct missing `user_id` values; it relies entirely on the auth context.
- It does not distinguish between "no active socket" and underlying infrastructure issues beyond logging and returning `socketId: null` or a `500` error.
- Future enhancements could include rate limiting or caching if this endpoint is called frequently for presence-style queries.
