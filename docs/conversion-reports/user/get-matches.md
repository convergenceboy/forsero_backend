## GetMatches Conversion Report

### Function overview

- **Original name**: `funcGetMatches`
- **Category**: `user` / matching
- **Purpose**: Retrieve nearby user matches within a tenant based on location and shared interest hashes, enforcing authentication and tenant scoping.

### Original v3 implementation summary

- **Location**: `/backend/funcGetMatches/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Behavior**:
  - Initializes services with `initializeApp()` and logs warnings on failure without aborting.
  - Resolves tenant via `resolveTenant(request)` and validates access with `validateTenantAccess(tenant, 'read')`:
    - If access is denied: returns `403` with `{ error: 'Tenant access denied' }`.
    - If tenant resolution/validation fails: returns `400` with `{ error: 'Invalid tenant domain' }`.
  - Extracts and validates JWT via `authRepository.extractAuthFromRequest(request)`:
    - On failure: returns `401` with `{ error: 'Authentication required' }`.
  - Reads the following from `request.body`:
    - `user_id`, `latitude`, `longitude`, `hashedInterests`.
  - Validates these fields:
    - If any are missing or `hashedInterests` is not an array: returns `400` with
      - `{ error: '`user_id`, `latitude`, `longitude`, and `hashedInterests` required' }`.
  - Ensures the caller can only request matches for themselves:
    - Compares `auth.user_id` to `user_id` and returns `403` with `{ error: 'Unauthorized - can only get matches for yourself' }` on mismatch.
  - Verifies that the user belongs to the tenant via `authRepository.getUserById(tenant.id, user_id)`:
    - On DB error: returns `500` with `{ error: 'Database error occurred' }`.
    - If user not found: returns `403` with `{ error: 'User not found in tenant' }`.
  - Computes matches using `interestRepository.findNearbyUsersWithSharedInterests` with:
    - `tenant.id`, `longitude`, `latitude`, `user_id`, `radiusMeters = 50`, `hashedInterests`, `maxUsers = 50`.
    - On DB error: returns `500` with `{ error: 'Failed to retrieve matches' }`.
  - On success: returns `200` with JSON body:
    - `{ matches, tenant: tenant.displayName }`.
  - On outer error: logs and returns `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/user/get-matches.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `GetMatches`.
- **Route**: `user/get-matches` (called as `/api/user/get-matches` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `userGetMatchesHandler`.
  - Returns `HttpResponseInit` (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization via `initializeApp()` with non-fatal logging.
  - Resolves tenant with `resolveTenant(request)` and validates `validateTenantAccess(tenant, 'read')`:
    - Access denied → `403` with `{ error: 'Tenant access denied' }`.
    - Tenant resolution/validation failure → logs a warning and returns `400` with `{ error: 'Invalid tenant domain' }`.
  - Authenticates via `authRepository.extractAuthFromRequest`:
    - Normalizes v4 `request.headers` (Headers-like) into a plain `{ headers: ... }` structure expected by the repository.
    - On failure: logs a warning and returns `401` with `{ error: 'Authentication required' }`.
  - Parses body with `await request.json()` and extracts `user_id`, `latitude`, `longitude`, and `hashedInterests`:
    - On parse failure: treats body as `{}` and falls back to validation.
    - Missing `user_id`, `latitude`, or `longitude`, or non-array `hashedInterests` → `400` with the same aggregated error message.
  - Enforces that the caller can only retrieve matches for themselves:
    - If `auth.user_id !== user_id` → `403` with `{ error: 'Unauthorized - can only get matches for yourself' }`.
  - Verifies that the user belongs to the tenant via `authRepository.getUserById(tenant.id, user_id)`:
    - On DB error: logs an error and returns `500` with `{ error: 'Database error occurred' }`.
    - If user is not found: returns `403` with `{ error: 'User not found in tenant' }`.
  - Calls `interestRepository.findNearbyUsersWithSharedInterests` with the same arguments and defaults (`radiusMeters = 50`, `maxUsers = 50`):
    - On DB error: logs and returns `500` with `{ error: 'Failed to retrieve matches' }`.
    - On success: returns `200` with `jsonBody` `{ matches, tenant: tenant.displayName }`.
  - On outer error: logs `"Error in GetMatches"` and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: `funcGetMatches` (e.g. `/api/funcGetMatches`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["post"]`.
- **New**:
  - Route: `user/get-matches` (accessed as `/api/user/get-matches`).
  - Binding: declared via:
    - `app.http('GetMatches', { methods: ['POST'], authLevel: 'function', route: 'user/get-matches', handler: userGetMatchesHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution, read-access validation, and tenant scoping for matches.
  - Authentication requirement and self-only access semantics (`auth.user_id === user_id`).
  - Required input fields and shared error message for missing/invalid fields.
  - Delegation to `interestRepository.findNearbyUsersWithSharedInterests` with identical parameters and defaults.
  - Success and error response shapes and status codes.
- **Differences / clarifications**:
  - Uses v4 `request.json()` and header normalization, but maintains equivalent behavior for well-formed requests.
  - Error logging is slightly richer for DB and auth failures.
- **Edge cases**:
  - Invalid JSON bodies result in default `{}` and trigger the same field validation as in v3.
  - When no matches are found, `matches` will typically be an empty array; this is treated as a successful 200 response.
  - If `authRepository.getUserById` or `interestRepository.findNearbyUsersWithSharedInterests` change behavior, this function relies on their contracts for error handling.

### Testing considerations

- **Integration tests should**:
  - Register a passwordless user, obtain a JWT via the passwordless flow, and (optionally) seed additional users and interest/location data to produce matches.
  - Call `POST /api/user/get-matches` with:
    - Headers: `Authorization: Bearer <jwt>`, tenant headers, and function key.
    - Body: `{ "user_id": <authUserId>, "latitude": <lat>, "longitude": <lon>, "hashedInterests": [...] }`.
  - Verify:
    - Status `200` and body containing `matches` (an array) and `tenant`.
    - Optionally, that matches are non-empty and respect spatial/interest constraints when the database is seeded accordingly.
  - Exercise error paths:
    - Missing/invalid body fields → `400`.
    - Missing/invalid token → `401`.
    - Mismatched `user_id` → `403`.
    - User not in tenant → `403` with corresponding error.
    - Simulated DB errors → `500` with appropriate messages.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, `authRepository.getUserById`, and `interestRepository.findNearbyUsersWithSharedInterests` to cover all branches.

### Known limitations / TODOs

- The function assumes that `hashedInterests` are already computed and valid; any normalization/hashing is out of scope and should be handled by clients or upstream services.
- Matching parameters such as `radiusMeters` and `maxUsers` are hard-coded; future iterations could expose them as configurable inputs with validation.
- Common authentication and tenant-handling patterns could be further refactored into shared utilities to reduce duplication across user-related v4 functions.
