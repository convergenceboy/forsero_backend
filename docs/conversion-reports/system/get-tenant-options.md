## GetTenantOptions Conversion Report

### Function overview

- **Original name**: `funcGetTenantOptions`
- **Category**: `system` / tenant configuration
- **Purpose**: Return age brackets and maturity levels for a tenant, with proper tenant resolution, access validation, and error handling.

### Original v3 implementation summary

- **Location**: `/backend/funcGetTenantOptions/index.js`
- **Trigger**: HTTP (`httpTrigger`, methods: `GET`, `POST`, `authLevel: function`).
- **Behavior**:
  - Calls `initializeApp()` from `services/serviceInit.js`, logging a warning if initialization fails but continuing execution.
  - Resolves the tenant from the incoming request using `resolveTenant(req)` from `services/serviceTenant.js`.
  - Validates access via `validateTenantAccess(tenant, 'read')`:
    - If access is denied, returns `403` with `{ error: 'Tenant access denied' }`.
  - On tenant resolution/validation failure:
    - Returns `400` with `{ error: 'Invalid tenant configuration' }`.
  - Uses `tenantRepository.getTenantOptions(tenant.id)` to retrieve tenant options:
    - Combined age brackets and maturity levels.
    - On repository/database failure, returns `500` with `{ error: 'Failed to retrieve tenant options' }`.
  - On success:
    - Returns `200` with body:
      - All fields from `options` (`ageBrackets`, `defaultAgeBracket`, `maturityLevels`, `defaultMaturityLevel`).
      - Additional `tenant` field containing `tenant.displayName`.
  - On unexpected outer error:
    - Returns `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/system/get-tenant-options.js`
- **Trigger**: HTTP (via `app.http`, methods: `GET`, `POST`, `authLevel: function`).
- **Azure Function name**: `GetTenantOptions`.
- **Route**: `system/get-tenant-options` (called as `/api/system/get-tenant-options` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with a dedicated handler `systemGetTenantOptionsHandler`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization semantics:
    - Attempts `initializeApp()`, logs a warning on failure, and continues.
  - Resolves the tenant with `resolveTenant(request)` using the v4-style request object.
  - Validates access with `validateTenantAccess(tenant, 'read')`:
    - On failure, returns `403` with `{ error: 'Tenant access denied' }`.
  - On tenant resolution/validation error:
    - Logs a warning and returns `400` with `{ error: 'Invalid tenant configuration' }`.
  - Retrieves options via `tenantRepository.getTenantOptions(tenant.id)`:
    - On failure, logs the error and returns `500` with `{ error: 'Failed to retrieve tenant options' }`.
  - On success:
    - Returns `200` with the combined options and `tenant` display name:
      - `{ ...options, tenant: tenant.displayName }`.
  - On outer/unexpected error:
    - Logs the error and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: implicit v3 HTTP trigger route (likely `/api/funcGetTenantOptions`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["get", "post"]`.
- **New**:
  - Route: `system/get-tenant-options` (accessed as `/api/system/get-tenant-options`).
  - Binding: declared via:
    - `app.http("GetTenantOptions", { methods: ["GET", "POST"], authLevel: "function", route: "system/get-tenant-options", handler: systemGetTenantOptionsHandler })`.
  - HTTP methods and auth level are preserved to maintain compatibility.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Initialization pattern with non-fatal failures.
  - Tenant resolution and access validation via `resolveTenant` and `validateTenantAccess`.
  - Distinct HTTP status codes and error messages:
    - `400` for invalid tenant configuration.
    - `403` for denied tenant access.
    - `500` for repository/database and unexpected errors.
  - Response shape on success:
    - Combined tenant options plus `tenant` display name.
- **Differences / clarifications**:
  - Route is now explicitly namespaced under `system/`, improving API shape and discoverability.
  - Logging is performed via `context.log` with optional chaining; log content is equivalent but may have slightly different formatting than v3.
- **Edge cases**:
  - If `tenantRepository.getTenantOptions` returns empty structures, the API still returns `200` with valid, but possibly empty, option arrays.
  - If the tenant cannot be resolved from the request headers/host information, callers receive a deterministic `400` with a generic error message.

### Testing considerations

- Integration tests should:
  - Call `GET /api/system/get-tenant-options` with appropriate tenant-identifying headers or host information (as required by `resolveTenant`).
  - Validate:
    - Status `200` and presence of keys:
      - `ageBrackets`, `defaultAgeBracket`, `maturityLevels`, `defaultMaturityLevel`, `tenant`.
  - Exercise error cases where:
    - Tenant identification is invalid or missing (expect `400`).
    - Tenant access is denied (expect `403`).
    - Internal failures lead to `500`.
- Unit tests can:
  - Mock `resolveTenant`, `validateTenantAccess`, and `tenantRepository.getTenantOptions` to simulate the various success and error paths.

### Known limitations / TODOs

- The function assumes `resolveTenant` and `validateTenantAccess` encapsulate all necessary security checks; any changes to tenant access policy must be reflected there.
- The response includes tenant display name but not additional tenant metadata; if more UI context is required, the contract may need expanding.
- Rate limiting or per-tenant throttling is not implemented at this layer and may need to be added via infrastructure or middleware.
