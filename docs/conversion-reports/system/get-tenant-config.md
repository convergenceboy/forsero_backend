## GetTenantConfig Conversion Report

### Function overview

- **Original name**: `funcGetTenantConfig`
- **Category**: `system` / tenant configuration
- **Purpose**: Return tenant configuration by domain with proper authentication and security:
  - Full configuration for authenticated requests.
  - Limited public configuration for unauthenticated requests.

### Original v3 implementation summary

- **Location**: `/backend/funcGetTenantConfig/index.js`
- **Trigger**: HTTP (`httpTrigger`, methods: `GET`, `POST`, `authLevel: function`).
- **Behavior**:
  - Calls `initializeApp()` from `services/serviceInit.js`, logging a warning if initialization fails but continuing execution.
  - Reads the tenant **domain** from:
    - `req.query.domain` or
    - `req.body.domain`.
  - If no domain is provided:
    - Returns `400` with `{ error: 'Missing domain parameter' }`.
  - Attempts to authenticate the request via `authRepository.extractAuthFromRequest(req)`:
    - On success: marks the request as authenticated.
    - On failure: treats the request as unauthenticated (but does not fail the request).
  - Retrieves tenant config based on authentication:
    - **Authenticated**: `tenantRepository.getTenantConfigByDomain(domain)`.
    - **Unauthenticated**: `tenantRepository.getTenantPublicConfig(domain)`.
  - On repository/database error:
    - Returns `500` with `{ error: 'Failed to retrieve tenant configuration' }`.
  - If no tenant config is found:
    - Returns `404` with `{ error: 'Tenant not found' }`.
  - On success:
    - Returns `200` with the tenant configuration object as the body.
  - On outer/unexpected error:
    - Returns `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/system/get-tenant-config.js`
- **Trigger**: HTTP (via `app.http`, methods: `GET`, `POST`, `authLevel: function`).
- **Azure Function name**: `GetTenantConfig`.
- **Route**: `system/get-tenant-config` (called as `/api/system/get-tenant-config` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `systemGetTenantConfigHandler`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization semantics:
    - Attempts `initializeApp()`, logs a warning on failure, and continues.
  - Reads `domain` from:
    - `request.query.get('domain')`, then
    - `await request.json()` (if needed), extracting `body.domain`.
  - If no domain is provided:
    - Returns `400` with `{ error: 'Missing domain parameter' }`.
  - Authentication:
    - Calls `authRepository.extractAuthFromRequest(request)`:
      - On success: marks `isAuthenticated = true`.
      - On failure: logs a warning and treats the request as unauthenticated (public config path).
  - Retrieves tenant config based on authentication:
    - **Authenticated**: `tenantRepository.getTenantConfigByDomain(domain)`.
    - **Unauthenticated**: `tenantRepository.getTenantPublicConfig(domain)`.
  - On repository/database error:
    - Logs the error and returns `500` with `{ error: 'Failed to retrieve tenant configuration' }`.
  - If no tenant config is found:
    - Returns `404` with `{ error: 'Tenant not found' }`.
  - On success:
    - Returns `200` with the tenant configuration as `jsonBody`.
  - On outer/unexpected error:
    - Logs the error and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: default v3 route (likely `/api/funcGetTenantConfig`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["get", "post"]`.
- **New**:
  - Route: `system/get-tenant-config` (accessed as `/api/system/get-tenant-config`).
  - Binding: declared via:
    - `app.http("GetTenantConfig", { methods: ["GET", "POST"], authLevel: "function", route: "system/get-tenant-config", handler: systemGetTenantConfigHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Domain parameter handling (`domain` via query or body).
  - Authentication/unauthentication split between full and public tenant configuration.
  - Status codes and messages for:
    - `400` (missing domain).
    - `404` (tenant not found).
    - `500` (database failure or unexpected error).
  - Graceful fallback to public configuration when authentication fails.
- **Differences / clarifications**:
  - Request parsing now uses the v4 HttpRequest API (`request.query` and `request.json()`), but the external behavior is the same.
  - Route is explicitly namespaced under `system/`.
- **Edge cases**:
  - If authentication fails due to missing or invalid credentials, the function still attempts to return a public tenant config.
  - If the request body is not valid JSON, the handler ignores the body and relies solely on the query parameter for `domain`.

### Testing considerations

- Integration tests should:
  - Call `GET /api/system/get-tenant-config?domain=<tenant-domain>`:
    - Without auth → expect limited public config (e.g., `theme` but not `features`/`matching`).
    - With valid auth (matching how `authRepository.extractAuthFromRequest` expects credentials) → expect full tenant config.
  - Verify response codes:
    - `400` when `domain` is missing.
    - `404` for non-existent domains.
    - `500` when repository/database failures are simulated.
- Unit tests can:
  - Mock `authRepository.extractAuthFromRequest`, `tenantRepository.getTenantConfigByDomain`, and `tenantRepository.getTenantPublicConfig` to exercise all branches.

### Known limitations / TODOs

- The shape of the tenant configuration object is defined by `TenantRepository.getTenantConfigByDomain` and `getTenantPublicConfig`; changes there will directly affect this endpoint and its clients.
- Authentication behavior and requirements depend on `authRepository.extractAuthFromRequest`; any changes to authentication schemes must keep this function in sync.
