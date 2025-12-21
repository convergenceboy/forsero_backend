## GetNearbyActivity Conversion Report

### Function overview

- **Original name**: `funcGetNearbyActivity`
- **Category**: `user` / location & community
- **Purpose**: Return anonymized community activity data around a given location within a tenant.

### Original v3 implementation summary

- **Location**: `/backend/funcGetNearbyActivity/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Behavior**:
  - Initializes services via `initializeApp()`, logging warnings on failure but continuing.
  - Resolves tenant via `resolveTenant(req)` and validates `validateTenantAccess(tenant, 'read')`:
    - Access denied → `403` with `{ error: 'Tenant access denied' }`.
    - Resolution/validation failure → `400` with `{ error: 'Invalid tenant domain' }`.
  - Authenticates via `authRepository.extractAuthFromRequest(req)`:
    - On failure: returns `401` with `{ error: 'Authentication required' }`.
  - Reads `{ latitude, longitude, radiusKm = 25 }` from `req.body`:
    - If `!latitude` or `!longitude`: returns `400` with `{ error: 'Latitude and longitude required' }`.
  - Retrieves activity via `locationRepository.getNearbyActivityData(tenant.id, latitude, longitude, radiusKm)`:
    - On success: returns `200` with body `{ ...activityData, tenantKey: tenant.key, radius: radiusKm }`.
    - On error: returns `500` with `{ error: 'Failed to retrieve activity data' }`.
  - On outer error: logs and returns `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/user/get-nearby-activity.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `GetNearbyActivity`.
- **Route**: `user/get-nearby-activity` (called as `/api/user/get-nearby-activity` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `userGetNearbyActivityHandler`.
  - Returns `HttpResponseInit` (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization, tenant resolution, and access validation semantics.
  - Authenticates using `authRepository.extractAuthFromRequest` with normalized headers:
    - Converts v4 `request.headers` (Headers-like) into a plain `{ headers: ... }` structure expected by the repository.
    - On failure: logs a warning and returns `401` with `{ error: 'Authentication required' }`.
  - Parses body with `await request.json()` and extracts `latitude`, `longitude`, `radiusKm` (default 25):
    - On parse failure: treats body as `{}`.
    - Missing `latitude` or `longitude` → `400` with `{ error: 'Latitude and longitude required' }`.
  - Calls `locationRepository.getNearbyActivityData(tenant.id, latitude, longitude, radiusKm)`:
    - On error: logs and returns `500` with `{ error: 'Failed to retrieve activity data' }`.
    - On success: returns `200` with `jsonBody` `{ ...activityData, tenantKey: tenant.key, radius: radiusKm }`.
  - On outer error: logs `"Error in GetNearbyActivity"` and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: `funcGetNearbyActivity` (e.g. `/api/funcGetNearbyActivity`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["post"]`.
- **New**:
  - Route: `user/get-nearby-activity` (accessed as `/api/user/get-nearby-activity`).
  - Binding: declared via:
    - `app.http('GetNearbyActivity', { methods: ['POST'], authLevel: 'function', route: 'user/get-nearby-activity', handler: userGetNearbyActivityHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and read-access checks.
  - Authentication requirement via JWT.
  - Input validation for `latitude` and `longitude`.
  - Delegation to `locationRepository.getNearbyActivityData` with the same arguments and default `radiusKm`.
  - Response shape and status codes for success and errors.
- **Differences / clarifications**:
  - Uses v4 `request.json()` and header normalization but keeps semantics identical for valid requests.
  - Logs more detail for tenant resolution and service errors.
- **Edge cases**:
  - Invalid JSON bodies are treated as `{}` and then rejected by the latitude/longitude validation.
  - If the underlying repository returns an empty dataset, the function still returns `200` with that dataset.

### Testing considerations

- **Integration tests should**:
  - Register a user and obtain a JWT via the existing passwordless flow.
  - Call `POST /api/user/get-nearby-activity` with:
    - Headers: `Authorization: Bearer <jwt>`, tenant headers, and function key.
    - Body: `{ "latitude": <number>, "longitude": <number>, "radiusKm": <optional number> }`.
  - Verify:
    - Status `200` and that the body includes `tenantKey`, `radius`, and the expected activity fields from the repository.
  - Exercise error paths:
    - Missing coordinates → `400`.
    - Missing/invalid token → `401`.
    - Simulated repository errors → `500` with clear error message.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, and `locationRepository.getNearbyActivityData` to cover all branches.

### Known limitations / TODOs

- The function assumes `latitude` and `longitude` are meaningful and does not clamp or normalize them.
- `radiusKm` is optional and defaults to 25; future iterations might support more sophisticated radius validation or limits.
- As with other user functions, common auth/tenant orchestration code could be refactored into shared utilities to reduce duplication.
