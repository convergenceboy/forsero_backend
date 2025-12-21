## GetAllTenants Conversion Report

### Function overview

- **Original name**: `funcGetAllTenants`
- **Category**: `system`
- **Purpose**: Return all active tenants for a public tenant selection screen, with initialization and logging.

### Original v3 implementation summary

- **Location**: `/backend/funcGetAllTenants/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `GET`, `authLevel: function`).
- **Behavior**:
  - Calls `initializeApp()` from `services/serviceInit.js`, logging a warning if initialization fails but continuing execution.
  - Treats the function as **public**:
    - No authentication required, because users must select a tenant before authenticating.
  - Uses `tenantRepository.getAllTenants()` to retrieve all active tenants.
    - On repository/database error, returns `500` with `{ error: 'Failed to retrieve tenants' }`.
  - On success, returns `200` with the list of tenants.
  - On any outer error, logs it and returns `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/system/get-all-tenants.js`
- **Trigger**: HTTP (via `app.http`, method: `GET`, `authLevel: anonymous`).
- **Azure Function name**: `GetAllTenants`.
- **Route**: `system/get-all-tenants` (called as `/api/system/get-all-tenants` by default).
- **Structure changes**:
  - Uses v4 `app.http` registration with a dedicated handler `systemGetAllTenantsHandler`.
  - Returns `HttpResponseInit` objects with `status` and `jsonBody` instead of mutating `context.res`.
- **Logic**:
  - Preserves the initialization pattern:
    - Attempts `initializeApp()`, logs a warning on failure, and continues.
  - Uses `tenantRepository.getAllTenants()` from `/backend-v4/repositories/TenantRepository.js` to retrieve tenant data.
  - On repository/database error:
    - Logs the error.
    - Returns `500` with `{ error: 'Failed to retrieve tenants' }`.
  - On success:
    - Returns `200` with the tenant list as JSON.
  - On outer/uncaught errors:
    - Logs the error.
    - Returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: implicit v3 HTTP trigger route (likely `/api/funcGetAllTenants`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["get"]`.
- **New**:
  - Route: `system/get-all-tenants` (accessed as `/api/system/get-all-tenants`).
  - Binding: declared via:
    - `app.http("GetAllTenants", { methods: ["GET"], authLevel: "anonymous", route: "system/get-all-tenants", handler: systemGetAllTenantsHandler })`.
  - **Auth level adjustment**:
    - Set to `anonymous` to better reflect the original intention of a public tenant selection endpoint.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Use of `initializeApp()` with non-fatal failures logged.
  - Retrieval of active tenants through the tenant repository.
  - Error responses for repository or unexpected failures.
- **Differences / clarifications**:
  - **Auth level**:
    - Explicitly set to `anonymous` in v4, aligning with the documented public nature of the endpoint.
  - **Logging**:
    - Uses `context.log` for errors and warnings; behavior is analogous but may produce slightly different log formatting than v3.
- **Edge cases**:
  - If `tenantRepository.getAllTenants()` returns an empty array, the function returns `200` with an empty list.
  - If the repository throws, the function consistently returns a `500` error with a generic message, mirroring the v3 behavior.

### Testing considerations

- Integration tests should:
  - Call `GET /api/system/get-all-tenants` without authentication and expect:
    - Status `200` on success.
    - A JSON array body.
  - Optionally verify that the returned tenant objects contain the expected keys defined by `TenantRepository.getAllTenants()`.
- Unit tests can:
  - Mock `tenantRepository.getAllTenants()` to simulate success, failure, and empty results.
  - Mock `initializeApp()` to simulate initialization failures and ensure the function still attempts to serve the request.

### Known limitations / TODOs

- The function currently exposes all active tenants without paging or filtering; this may not scale for very large tenant sets.
- Error messages are intentionally generic to avoid leaking internal details.
- Additional audit logging (e.g., request metadata, IP) could be added at the HTTP layer or inside the repository for stricter compliance requirements.
