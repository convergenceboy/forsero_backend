## RealtimeNegotiate Conversion Report

### Function overview

- **Original name**: `tayab_funcNegotiate`
- **Category**: `realtime` / Socket.IO negotiation
- **Purpose**: Negotiate a Web PubSub for Socket.IO connection for an authenticated user, using the `socketionegotiation` binding and enforcing tenant + auth checks.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcNegotiate/index.js`
- **Trigger**: HTTP (`httpTrigger`, methods: `GET`, `POST`, `authLevel: function`).
- **Bindings**:
  - HTTP input (`req`) and HTTP output (`res`).
  - `socketionegotiation` input binding named `negotiateResult`:
    - `hub: "hub"`.
    - `userId: "{query.userId}"`.
- **Behavior**:
  - Initializes services via `initializeApp()` inside a non-fatal try/catch (logs but does not abort on failure).
  - Resolves tenant with `resolveTenant(request)` and validates with `validateTenantAccess(tenant, "read")`:
    - On invalid tenant: returns `400` with `{ error: "Invalid tenant domain" }`.
    - On denied access: returns `403` with `{ error: "Tenant access denied" }`.
  - Extracts authentication via `authRepository.extractAuthFromRequest(request)`:
    - If no auth context: returns `401` with `{ error: "Authentication required" }`.
  - Reads the negotiation result from `context.bindings?.negotiateResult`:
    - If missing: returns `500` with `{ error: "Negotiation failed" }`.
  - On success:
    - Logs `"funcNegotiate success"` with the negotiation payload.
    - Returns `200` with the raw `negotiateResult` as the response body.
  - On outer error:
    - Logs `"funcNegotiate error"` and returns `500` with `{ error: "Internal server error" }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/realtime/negotiate.js`
- **Trigger**: HTTP (via `app.http`, methods: `GET`, `POST`, `authLevel: function`).
- **Azure Function name**: `RealtimeNegotiate`.
- **Route**: `realtime/negotiate` (invoked as `/api/realtime/negotiate` by default).
- **Structure changes**:
  - Uses v4 `app.http` registration with a dedicated handler `realtimeNegotiateHandler`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
  - Uses a v4-style generic input binding built with `input.generic(...)` and accessed via `context.extraInputs`.
- **Logic**:
  - Preserves initialization behavior:
    - Calls `initializeApp()` in a nested try/catch; logs a warning on failure and continues.
  - Preserves tenant resolution and access validation:
    - Calls `resolveTenant(request)` and `validateTenantAccess(tenant, "read")`.
    - On failure: returns `400` (`Invalid tenant domain`) or `403` (`Tenant access denied`) with the same messages as v3.
  - Preserves authentication requirement semantics:
    - Normalizes v4 `request.headers` (which may be a `Headers`-like object) into a plain `{ headers: ... }` object expected by `authRepository.extractAuthFromRequest`.
    - On auth failure: logs a warning and returns `401` with `{ error: "Authentication required" }`.
  - Invokes the `socketionegotiation` binding via `context.extraInputs.get(socketIONegotiateInput)`:
    - If no result is returned: logs an error and returns `500` with `{ error: "Negotiation failed" }`.
  - On success:
    - Logs `"RealtimeNegotiate success"` with tenant context.
    - Returns `200` with `jsonBody` set to the negotiation result from the binding.
  - On outer error:
    - Logs `"Internal error in RealtimeNegotiate"` and returns `500` with `{ error: "Internal server error" }`.

### Route and binding changes

- **Original**:
  - Route: implicitly `tayab_funcNegotiate` (e.g. `/api/tayab_funcNegotiate`).
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
        },
        {
          "type": "socketionegotiation",
          "direction": "in",
          "name": "negotiateResult",
          "hub": "hub",
          "userId": "{query.userId}"
        }
      ]
    }
    ```
- **New**:
  - Route: `realtime/negotiate` (accessed as `/api/realtime/negotiate`).
  - Binding: declared via code using v4 input bindings:
    - Generic Socket.IO negotiation input:
      ```js
      const socketIONegotiateInput = input.generic({
        type: "socketionegotiation",
        direction: "in",
        name: "negotiateResult",
        hub: "hub",
        userId: "{query.userId}",
      });
      ```
    - HTTP trigger registration:
      ```js
      app.http("RealtimeNegotiate", {
        methods: ["GET", "POST"],
        authLevel: "function",
        route: "realtime/negotiate",
        extraInputs: [socketIONegotiateInput],
        handler: realtimeNegotiateHandler,
      });
      ```

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Requires a valid tenant and enforces `validateTenantAccess(tenant, "read")`.
  - Requires JWT-based authentication for negotiation and returns `401` when missing/invalid.
  - Uses the same `socketionegotiation` hub (`hub`) and `userId` binding expression (`{query.userId}`).
  - Returns `500` with `{ error: "Negotiation failed" }` when no negotiation result is available.
  - Returns `500` with `{ error: "Internal server error" }` on uncaught exceptions.
- **Differences / clarifications**:
  - Tenant and auth handling now follow the shared v4 patterns:
    - Header normalization for `authRepository.extractAuthFromRequest`.
    - More structured logging via `context.log?.warn` and `context.log?.error`.
  - The response is explicitly a v4 `HttpResponseInit` instead of writing to `context.res`, but status codes and JSON bodies are equivalent.
  - The function is now categorized under `realtime` with a clearer route shape (`/api/realtime/negotiate`), which may require client updates (addressed via the new client module).
- **Edge cases**:
  - If the `userId` query parameter is missing or malformed, the `socketionegotiation` binding itself may fail or return a null/undefined result, which is surfaced as a `500 Negotiation failed`.
  - If tenant resolution falls back to development defaults (non-production), negotiation may succeed even without a stored tenant record; this mirrors v4 tenant resolution behavior in other endpoints.

### Testing considerations

- **Integration tests should**:
  - Use the passwordless auth flow to obtain a valid JWT and `user_id` for a test user.
  - Call `GET /api/realtime/negotiate?userId=<user_id>` with:
    - Headers:
      - `Authorization: Bearer <jwt>`.
      - `x-functions-key: <function key>` (if required).
      - `x-tenant-domain` and `x-forsero-tenant-domain` to drive tenant resolution.
  - Verify:
    - Status `200` on success.
    - A non-empty JSON negotiation payload (fields are defined by the Web PubSub Socket.IO extension).
  - Exercise error paths:
    - Missing/invalid tenant headers → `400` or `403` with the documented error messages.
    - Missing/invalid `Authorization` header → `401` with `{ error: "Authentication required" }`.
    - Simulated binding failures (e.g. misconfigured hub) → `500` with `{ error: "Negotiation failed" }`.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, and `context.extraInputs.get` to cover all branches without hitting external services.

### Known limitations / TODOs

- The exact shape of the negotiation payload is controlled by the Web PubSub for Socket.IO extension; the function currently forwards it verbatim without validation.
- Common patterns for tenant and auth handling could be further abstracted into shared helpers across realtime and REST-style functions.
- Future enhancements may include explicit validation of the `userId` query parameter and more detailed error responses for binding-level failures.
