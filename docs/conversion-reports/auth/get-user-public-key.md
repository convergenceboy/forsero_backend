## GetUserPublicKey Conversion Report

### Function overview

- **Original name**: `funcGetUserPublicKey`
- **Category**: `auth` / ephemeral messaging
- **Purpose**: Retrieve a user's stored public key for ephemeral messaging within a tenant, enforcing tenant resolution and authentication at the orchestration layer.

### Original v3 implementation summary

- **Location**: `/backend/funcGetUserPublicKey/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Behavior**:
  - Acts as a ROE-compliant orchestration layer with no business logic or SQL:
    - Handles HTTP input/output, tenant resolution, authentication, repository calls, and response formatting.
  - Initializes services via `initializeApp()` (logs a warning on failure but continues execution).
  - Resolves tenant via `resolveTenant(req)` and validates access using `validateTenantAccess(tenant, 'read')`:
    - On access denied: returns `403` with `{ error: 'Tenant access denied' }`.
    - On resolution/validation failure: returns `400` with `{ error: 'Invalid tenant domain' }`.
  - Extracts authentication via `authRepository.extractAuthFromRequest(req)`:
    - On failure: returns `401` with `{ error: 'Authentication required' }`.
  - Validates request body:
    - Reads `{ user_id }` from `req.body`.
    - If `user_id` is missing: returns `400` with `{ error: 'user_id is required' }`.
  - Calls service layer to retrieve the public key via `authRepository.getUserPublicKey(tenant.id, user_id)`:
    - On success with a public key:
      - Returns `200` with:
        - `{ success: true, publicKey, user_id, tenant: tenant.displayName }`.
    - If no public key (e.g., user not found):
      - Returns `404` with `{ error: 'User not found', user_id }`.
  - On any uncaught error:
    - Returns `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/auth/get-user-public-key.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `GetUserPublicKey`.
- **Route**: `auth/get-user-public-key` (called as `/api/auth/get-user-public-key` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `authGetUserPublicKeyHandler`.
  - Returns `HttpResponseInit` (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves orchestration-only responsibilities:
    - Service initialization, tenant resolution, auth extraction, repository call, response shaping, and error handling.
  - Calls `initializeApp()` with a warning on failure but does not abort the request.
  - Resolves tenant using `resolveTenant(request)` and checks `validateTenantAccess(tenant, 'read')`:
    - Access denied → `403` with `{ error: 'Tenant access denied' }`.
    - Resolution/validation failure → logs a warning and returns `400` with `{ error: 'Invalid tenant domain' }`.
  - Extracts authentication via `authRepository.extractAuthFromRequest(request)`:
    - On failure: logs a warning and returns `401` with `{ error: 'Authentication required' }`.
  - Parses the request body via `await request.json()` and extracts `user_id`:
    - On parse failure: treats body as `{}` and falls back to the same `user_id` presence check.
    - Missing `user_id` → `400` with `{ error: 'user_id is required' }`.
  - Retrieves the public key via `authRepository.getUserPublicKey(tenant.id, user_id)` inside a `try` block:
    - On DB error: logs an error and returns `500` with `{ error: 'Internal server error' }` (matching v3's outer error behavior).
    - On success with a value:
      - Returns `200` with `jsonBody`:
        - `{ success: true, publicKey, user_id, tenant: tenant.displayName }`.
    - If `publicKey` is falsy:
      - Returns `404` with `{ error: 'User not found', user_id }`.
  - On any outer error:
    - Logs `"Internal error in GetUserPublicKey"` and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: default v3 route (likely `/api/funcGetUserPublicKey`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["post"]`.
- **New**:
  - Route: `auth/get-user-public-key` (accessed as `/api/auth/get-user-public-key`).
  - Binding: declared via:
    - `app.http('GetUserPublicKey', { methods: ['POST'], authLevel: 'function', route: 'auth/get-user-public-key', handler: authGetUserPublicKeyHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and read-access enforcement.
  - Authentication requirement via `authRepository.extractAuthFromRequest`.
  - Required `user_id` field in the request body and associated error messaging.
  - 200/404 responses based on whether a public key is found.
  - 500 error response on unexpected failures.
- **Differences / clarifications**:
  - Uses v4 `request.json()` for body parsing; behavior for valid JSON clients remains the same.
  - Database errors during `getUserPublicKey` are now explicitly logged before returning a 500 response.
  - The function name and route are more descriptive and are nested under the `auth/` namespace in v4.
- **Edge cases**:
  - Invalid JSON bodies result in an empty object and trigger the same `user_id` presence validation as in v3.
  - If `extractAuthFromRequest` throws due to missing/invalid tokens, callers receive a clear 401.
  - If the repository returns a falsy `publicKey` for an otherwise valid `user_id`, the function responds with `404` and echoes the `user_id` in the payload.

### Testing considerations

- **Integration tests should**:
  - Register a new user and store their public key (e.g., via `POST /api/auth/passwordless-register`).
  - Complete the passwordless authentication flow (request + verify challenge) to obtain a valid JWT for that user.
  - Call `POST /api/auth/get-user-public-key` with:
    - Body: `{ "user_id": <registeredUserId> }`.
    - Headers: `Authorization: Bearer <jwt>`, tenant headers, and function key.
  - Verify success responses:
    - Status `200` with body containing `success: true`, `publicKey`, `user_id`, and `tenant`.
    - Ensure the returned `publicKey` matches what was registered.
  - Exercise error responses:
    - Missing `user_id` → `400`.
    - Missing or invalid auth token → `401`.
    - Unknown `user_id` → `404` with `user_id` echoed.
    - Simulated DB failures → `500` with `{ error: 'Internal server error' }`.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, and `authRepository.getUserPublicKey` to cover all success and failure branches.

### Known limitations / TODOs

- The function trusts `extractAuthFromRequest` for all authentication details; any authorization logic beyond "is authenticated" (e.g., checking whether the caller is allowed to see another user's key) must be implemented in the repository/service layer.
- `user_id` is treated as an opaque identifier from the HTTP layer; additional validation (e.g., numeric constraints) could be added if the underlying schema requires it.
- Future work could centralize common auth/tenant orchestration patterns into shared utilities to reduce duplication across auth-related functions.

