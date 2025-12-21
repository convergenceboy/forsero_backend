## CheckUserExists Conversion Report

### Function overview

- **Original name**: `tayab_funcUserExists`
- **Category**: `auth` / identity lookup
- **Purpose**: Check whether a given username exists for the resolved tenant.

### Original v3 implementation summary

- **Location**: `/backend/tayab_funcUserExists/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Bindings**:
  - HTTP input (`req`) and HTTP output (`res`).
- **Behavior**:
  - Initializes services via `initializeApp()` in a nested `try/catch`:
    - On failure: logs `"Service initialization failed"` and continues without aborting.
  - Resolves tenant with `resolveTenant(request)` and validates access with `validateTenantAccess(tenant, "read")`:
    - On denied access: returns `403` with `{ error: "Tenant access denied" }`.
    - On failure: returns `400` with `{ error: "Invalid tenant configuration" }`.
  - Extracts `userName` from `request.body`:
    - If `!userName`: returns `400` with `{ error: "Username is required" }`.
  - Normalizes username:
    - `normalizedUserName = String(userName || "").trim().toLowerCase()`.
  - Calls `authRepository.getUserByUsername(tenant.id, normalizedUserName)`:
    - `exists = Boolean(user)`.
  - Logs `"funcUserExists success"` with `{ username, exists }`.
  - Returns `200` with body `{ exists }`.
  - On outer error: logs `"funcUserExists error"` and returns `500` with `{ error: "Internal server error" }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/auth/check-user-exists.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `CheckUserExists`.
- **Route**: `auth/check-user-exists` (invoked as `/api/auth/check-user-exists` by default).
- **Structure changes**:
  - Uses v4 `app.http` registration with handler `authCheckUserExistsHandler`.
  - Uses `HttpResponseInit` return values (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization semantics:
    - Calls `initializeApp()` in a nested `try/catch`; logs a warning and continues on failure.
  - Preserves tenant resolution and access validation:
    - Uses `resolveTenant(request)` and `validateTenantAccess(tenant, "read")`.
    - On failure: returns `400` with `{ error: "Invalid tenant configuration" }` or `403` with `{ error: "Tenant access denied" }`, matching v3 semantics.
  - Reads JSON request body via `await request.json()`:
    - Supports both `userName` (legacy) and `username` fields.
    - If neither is present or not a string: returns `400` with `{ error: "Username is required" }`.
  - Normalizes username exactly as in v3:
    - `normalizedUserName = String(rawUserName || "").trim().toLowerCase()`.
  - Calls `authRepository.getUserByUsername(tenant.id, normalizedUserName)`:
    - Computes `exists = Boolean(user)`.
  - Logs `"CheckUserExists success"` with `{ username, exists }`.
  - Returns `200` with:
    - `{ exists, username: normalizedUserName, tenant: tenant.displayName }`.
  - On outer error: logs `"Internal error in CheckUserExists"` and returns `500` with `{ error: "Internal server error" }`.

### Route and binding changes

- **Original**:
  - Route: implicitly `tayab_funcUserExists` (e.g. `/api/tayab_funcUserExists`).
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
        }
      ]
    }
    ```
- **New**:
  - Route: `auth/check-user-exists` (accessed as `/api/auth/check-user-exists`).
  - Binding: declared in code via:
    ```js
    app.http("CheckUserExists", {
      methods: ["POST"],
      authLevel: "function",
      route: "auth/check-user-exists",
      handler: authCheckUserExistsHandler,
    });
    ```

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and `validateTenantAccess(tenant, "read")` enforcement.
  - Initialization semantics (`initializeApp()` is best-effort and non-fatal).
  - Username normalization (`trim().toLowerCase()`) and validation.
  - Existence check via `authRepository.getUserByUsername`.
  - Error semantics for invalid tenant, denied access, missing username, and unhandled exceptions.
- **Differences / clarifications**:
  - The v4 implementation:
    - Accepts either `userName` or `username` in the JSON body (to be tolerant of newer clients).
    - Enriches the response with `username` and `tenant` in addition to `exists`. This is backwards compatible for existing callers that only read `exists`.
  - Logging messages have been renamed (`CheckUserExists success` vs `funcUserExists success`) but carry the same information.
  - The route is now explicitly namespaced under `auth/check-user-exists`, aligning it with other authentication-related endpoints.
- **Edge cases**:
  - If `authRepository.getUserByUsername` throws (e.g. database issues), the function returns `500` with `{ error: "Internal server error" }`, consistent with other auth v4 functions.
  - Non-string username fields (e.g. numbers or objects) result in a `400` with `Username is required`, rather than attempting to coerce them.

### Testing considerations

- **Integration tests should**:
  - Register a new user using the existing passwordless flow (`passwordlessRegister`).
  - Call `POST /api/auth/check-user-exists` with:
    - Headers: `x-functions-key`, `x-tenant-domain`, `x-forsero-tenant-domain`.
    - Body: `{ "username": "<registered_username>" }` or `{ "userName": "<registered_username>" }`.
  - Verify:
    - HTTP `200`.
    - Body `{ exists: true, username: "<normalized_username>", tenant: "<displayName>" }`.
  - For a non-existent username, verify:
    - HTTP `200`.
    - Body `{ exists: false, username: "<normalized_username>", tenant: "<displayName>" }`.
  - Exercise error paths:
    - Missing username → `400` with `{ error: "Username is required" }`.
    - Invalid tenant headers → `400`/`403` with the documented error messages.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, and `authRepository.getUserByUsername` to verify:
    - Proper normalization of `userName` / `username`.
    - Logging of success and error paths.
    - Correct HTTP statuses and response bodies for all branches.

### Known limitations / TODOs

- The function intentionally does not differentiate between “user not found” and “tenant misconfiguration” in the returned payload beyond status codes, to avoid leaking internal details.
- Potential rate limiting for brute-force existence checks is not implemented here and would need to be handled at a higher layer if required.
