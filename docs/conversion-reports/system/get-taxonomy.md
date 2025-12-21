## GetTaxonomy Conversion Report

### Function overview

- **Original name**: `funcGetTaxonomy`
- **Category**: `system` / taxonomy
- **Purpose**: Query Postgres for full normalized taxonomy and return it in a structure compatible with the refactored `InterestsScreen.js`, with multi-tenant awareness and maturity rating filtering.

### Original v3 implementation summary

- **Location**: `/backend/funcGetTaxonomy/index.js` (commented as `backend/functions/getTaxonomy.js`).
- **Trigger**: HTTP (`httpTrigger`, method: `GET`, `authLevel: function`, route: `funcGetTaxonomy`).
- **Behavior**:
  - Calls `initializeApp()` from `services/serviceInit.js`, logging a warning if initialization fails but continuing execution.
  - Resolves the tenant using `resolveTenant(request)` from `services/serviceTenant.js`.
  - Validates access via `validateTenantAccess(tenant, 'read')`:
    - If access is denied, returns `403` with `{ error: 'Tenant access denied' }`.
  - On tenant resolution/validation failure:
    - Returns `400` with `{ error: 'Invalid tenant domain' }`.
  - Requires a `maturityRating` query parameter:
    - Reconstructs a `URL` object using the request URL and host (`x-tenant-domain` header or `host` header).
    - Reads `maturityRating` from the query string.
    - If missing, returns `400` with:
      - Headers: `Content-Type: application/json`.
      - Body: `{ error: 'maturityRating parameter is required' }`.
  - Uses `tenantRepository.getTenantTaxonomy(tenant.id, maxMaturityRating)` to fetch hierarchical taxonomy with maturity filtering.
    - On repository/database error, returns `500` with `{ error: 'Database error occurred' }`.
  - On success:
    - Returns `200` with:
      - Headers: `Content-Type: application/json`.
      - Body: `{ categories: taxonomy, tenant: tenant.displayName }`.
  - On outer/unexpected error:
    - Returns `500` with:
      - Headers: `Content-Type: application/json`.
      - Body: `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/system/get-taxonomy.js`
- **Trigger**: HTTP (via `app.http`, method: `GET`, `authLevel: function`).
- **Azure Function name**: `GetTaxonomy`.
- **Route**: `system/get-taxonomy` (called as `/api/system/get-taxonomy` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `systemGetTaxonomyHandler`.
  - Returns `HttpResponseInit` objects (`status`, `headers`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization semantics:
    - Attempts `initializeApp()`, logs a warning on failure, and continues.
  - Resolves tenant with `resolveTenant(request)` using the v4 HttpRequest object and updated header-handling logic.
  - Validates access with `validateTenantAccess(tenant, 'read')`:
    - On failure, returns `403` with `{ error: 'Tenant access denied' }`.
  - On tenant resolution/validation error:
    - Logs a warning and returns `400` with `{ error: 'Invalid tenant domain' }`.
  - Requires a `maturityRating` query parameter:
    - Uses `request.query.get('maturityRating')` (and a lowercase fallback) to read the value.
    - If missing, returns `400` with:
      - Headers: `Content-Type: application/json`.
      - `jsonBody: { error: 'maturityRating parameter is required' }`.
  - Calls `tenantRepository.getTenantTaxonomy(tenant.id, maxMaturityRating)`:
    - On failure, logs the error and returns `500` with `{ error: 'Database error occurred' }`.
  - On success:
    - Returns `200` with:
      - Headers: `Content-Type: application/json`.
      - `jsonBody: { categories: taxonomy, tenant: tenant.displayName }`.
  - On outer/unexpected error:
    - Logs the error and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: `funcGetTaxonomy`.
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["get"]`.
- **New**:
  - Route: `system/get-taxonomy` (accessed as `/api/system/get-taxonomy`).
  - Binding: declared via:
    - `app.http("GetTaxonomy", { methods: ["GET"], authLevel: "function", route: "system/get-taxonomy", handler: systemGetTaxonomyHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Initialization, tenant resolution, and access validation semantics.
  - Requirement and validation of the `maturityRating` parameter.
  - Distinct status codes and messages for:
    - `400` (invalid tenant domain or missing `maturityRating`).
    - `403` (tenant access denied).
    - `500` (database error or unexpected error).
  - Response shape of successful calls:
    - `{ categories: taxonomy, tenant: tenant.displayName }`.
- **Differences / clarifications**:
  - Query parsing now uses the v4 `request.query` API rather than constructing a `URL` from the raw request URL and host, but the visible behavior and required parameter name remain the same.
  - Route is explicitly namespaced under `system/`, aligning with other v4 system endpoints.
- **Edge cases**:
  - If `getTenantTaxonomy` returns an empty array, the endpoint still returns `200` with `categories: []`.

### Testing considerations

- Integration tests should:
  - Call `GET /api/system/get-taxonomy?maturityRating=<CODE>` with appropriate tenant-identifying headers (as required by `resolveTenant`).
  - Verify:
    - `200` status, JSON content type.
    - Response body includes:
      - `categories` (array of category objects).
      - `tenant` (display name).
  - Exercise error paths:
    - Missing `maturityRating` (expect `400`).
    - Invalid tenant domain or headers (expect `400` or `403` depending on case).
    - Simulated database failures (expect `500`).
- Unit tests can:
  - Mock `resolveTenant`, `validateTenantAccess`, and `tenantRepository.getTenantTaxonomy` to simulate the various success and failure scenarios.

### Known limitations / TODOs

- The endpoint currently exposes the full taxonomy structure as built by `TenantRepository.buildTaxonomyStructure`; any structural changes there will directly impact clients.
- The `maturityRating` values must align with entries in `master_maturity_ratings`; validation beyond presence is handled implicitly via the database query.
