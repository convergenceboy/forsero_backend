## UpdateLocation Conversion Report

### Function overview

- **Original name**: `funcUpdateLocation`
- **Category**: `user` / location
- **Purpose**: Store the user's most recent location for geo queries (PostGIS), with multi-tenant support and JWT-based authentication.

### Original v3 implementation summary

- **Location**: `/backend/funcUpdateLocation/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Behavior**:
  - Initializes services via `initializeApp()` and logs a warning on failure without aborting.
  - Resolves tenant using `resolveTenant(request)` and validates `validateTenantAccess(tenant, 'write')`:
    - If access is denied: returns `403` with `{ error: 'Tenant access denied' }`.
    - If tenant resolution/validation fails: returns `400` with `{ error: 'Invalid tenant domain' }`.
  - Extracts and validates JWT via `authRepository.extractAuthFromRequest(request)`:
    - On failure: returns `401` with `{ error: 'Authentication required' }`.
  - Reads `{ user_id, latitude, longitude }` from `request.body` and validates:
    - If `!user_id` or `latitude`/`longitude` are not numbers: returns `400` with JSON content type and
      - `{ error: '`user_id`, `latitude`, and `longitude` required' }`.
  - Ensures the caller can only update their own location:
    - If `auth.user_id && auth.user_id !== user_id`: returns `403` with JSON content type and
      - `{ error: 'Unauthorized - can only update your own location' }`.
  - Verifies the user belongs to the tenant via `authRepository.getUserById(tenant.id, user_id)`:
    - On DB error: returns `500` with `{ error: 'Database error occurred' }`.
    - If user not found: returns `403` with `{ error: 'User not found in tenant' }`.
  - Updates user location via `locationRepository.updateUserLocation(tenant.id, user_id, longitude, latitude)`:
    - On success: returns `200` with JSON body
      - `{ success: true, updatedAt: updateResult.last_updated, tenant: tenant.displayName }`.
    - On DB error: returns `500` with `{ error: 'Failed to update location' }`.
  - On outer error: returns `500` with `{ error: 'Internal server error' }` and JSON content type.

### v4 implementation summary

- **Location**: `/backend-v4/functions/user/update-location.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `UpdateLocation`.
- **Route**: `user/update-location` (called as `/api/user/update-location` by default).
- **Structure changes**:
  - Uses v4 `app.http` registration with handler `userUpdateLocationHandler`.
  - Returns `HttpResponseInit` (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization and tenant resolution/access validation semantics from v3.
  - Authenticates using `authRepository.extractAuthFromRequest` with normalized headers:
    - Converts v4 `request.headers` (Headers-like) into a plain `{ headers: ... }` structure expected by the repository.
    - On failure: logs a warning and returns `401` with `{ error: 'Authentication required' }`.
  - Parses request body using `await request.json()` and extracts `user_id`, `latitude`, `longitude`:
    - On parse failure: treats body as `{}` and falls back to validation.
    - Missing `user_id` or non-numeric `latitude`/`longitude` → `400` with `{ error: '`user_id`, `latitude`, and `longitude` required' }`.
  - Enforces self-only access:
    - If `auth.user_id && auth.user_id !== user_id` → `403` with `{ error: 'Unauthorized - can only update your own location' }`.
  - Verifies tenant membership via `authRepository.getUserById(tenant.id, user_id)`:
    - On DB error: logs an error and returns `500` with `{ error: 'Database error occurred' }`.
    - If user is not found: returns `403` with `{ error: 'User not found in tenant' }`.
  - Calls `locationRepository.updateUserLocation(tenant.id, user_id, longitude, latitude)`:
    - On DB error: logs an error and returns `500` with `{ error: 'Failed to update location' }`.
    - On success: returns `200` with `jsonBody` `{ success: true, updatedAt: updateResult?.last_updated ?? null, tenant: tenant.displayName }`.
  - On outer error: logs `"Internal error in UpdateLocation"` and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: `funcUpdateLocation` (e.g. `/api/funcUpdateLocation`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["post"]`.
- **New**:
  - Route: `user/update-location` (accessed as `/api/user/update-location`).
  - Binding: declared via:
    - `app.http('UpdateLocation', { methods: ['POST'], authLevel: 'function', route: 'user/update-location', handler: userUpdateLocationHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and write-access checks.
  - Authentication requirement and self-only update semantics.
  - Input validation for `user_id`, `latitude`, and `longitude`.
  - Tenant membership verification and error paths for not-found users.
  - Delegation to `locationRepository.updateUserLocation` with the same parameters.
  - Success and error response shapes and status codes.
- **Differences / clarifications**:
  - Uses v4 `request.json()` and header normalization; behavior is equivalent for valid JSON requests.
  - `updatedAt` now safely falls back to `null` if `updateResult.last_updated` is missing, which is backwards compatible but more defensive.
  - Logging includes more context for tenant resolution and DB errors.
- **Edge cases**:
  - Invalid JSON bodies result in an empty object and trigger field validation.
  - If the JWT is structurally valid but refers to a user not present in the tenant, the function returns `403` with a clear message.
  - If `locationRepository.updateUserLocation` changes its return shape, `updatedAt` may be `null`, but the function still signals success when no error is thrown.

### Testing considerations

- **Integration tests should**:
  - Register a passwordless user, obtain a JWT via the passwordless flow, and ensure the user exists in the tenant.
  - Call `POST /api/user/update-location` with:
    - Headers: `Authorization: Bearer <jwt>`, tenant headers, and function key.
    - Body: `{ "user_id": <authUserId>, "latitude": <number>, "longitude": <number> }`.
  - Verify:
    - Status `200` and body with `success: true`, `updatedAt` (string or null), and `tenant`.
  - Exercise error paths:
    - Missing/invalid `user_id`/coordinates → `400`.
    - Missing/invalid token → `401`.
    - Mismatched `user_id` → `403`.
    - User not found in tenant → `403`.
    - Simulated DB errors → `500` with appropriate messages.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, `authRepository.getUserById`, and `locationRepository.updateUserLocation` to cover all branches.

### Known limitations / TODOs

- The function trusts upstream processes to provide meaningful latitude/longitude; it does not enforce bounds or coordinate systems beyond type checks.
- Hard-coded behavior assumes write access is required for location updates; any future roles/permissions system might require more nuanced checks.
- Common authentication and tenant-handling patterns are duplicated with other user functions and could be further refactored into shared utilities.
