## RequestChallenge Conversion Report

### Function overview

- **Original name**: `funcRequestChallenge`
- **Category**: `auth` / passwordless challenge
- **Purpose**: Generate an authentication challenge for passwordless login with multi-tenant support, including rate limiting and a signed challenge format.

### Original v3 implementation summary

- **Location**: `/backend/funcRequestChallenge/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Behavior**:
  - Initializes services via `initializeApp()` (logs warning on failure).
  - Resolves tenant via `resolveTenant(req)` and validates access with `validateTenantAccess(tenant, 'read')`:
    - On access denied: `403` with `{ error: 'Tenant access denied' }`.
    - On resolution/validation failure: `400` with `{ error: 'Invalid tenant configuration' }`.
  - Reads `{ username, clientTimestamp }` from `req.body`:
    - If missing: `400` with `{ error: 'Missing required fields', required: ['username', 'clientTimestamp'] }`.
  - Fetches user by username via `authRepository.getUserByUsername(tenant.id, username)`:
    - On DB error: `500` with `{ error: 'Database error occurred' }`.
    - If user not found: `404` with `{ error: 'User not found' }`.
  - Checks rate limit via `authRepository.checkChallengeRateLimit(tenant.id, user.id)`:
    - If not allowed: `429` with `{ error: 'Rate limit exceeded', retryAfter }`.
  - Generates a “sophisticated challenge”:
    - Uses `nonce = generateSecureRandom(32)` and `timestamp = Date.now()`.
    - Computes HMAC signature using `serverSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production-make-it-long-and-random'`.
    - `fullChallenge = nonce:timestamp:serverSignature`.
    - `clientChallenge = nonce:timestamp`.
  - Persists challenge via `authRepository.createAuthChallenge(tenant.id, user.id, challenge.fullChallenge, expiresAt, clientTimestampDate)`:
    - `expiresAt` is 5 minutes from now.
    - On DB error: `500` with `{ error: 'Database error during challenge creation' }`.
  - On success:
    - Returns `200` with:
      - `{ challenge: clientChallenge, expiresAt: expiresAt.toISOString(), challengeId, tenant: tenant.displayName }`.
  - On outer error:
    - Returns `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/auth/request-challenge.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `RequestChallenge`.
- **Route**: `auth/request-challenge` (called as `/api/auth/request-challenge` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `authRequestChallengeHandler`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization, tenant resolution, and access validation:
    - Uses `initializeApp()`, `resolveTenant(request)`, and `validateTenantAccess(tenant, 'read')`.
  - On access denied: `403` with `{ error: 'Tenant access denied' }`.
  - On tenant resolution/validation failure: logs warning and returns `400` with `{ error: 'Invalid tenant configuration' }`.
  - Reads request body via `await request.json()` to extract `{ username, clientTimestamp }`:
    - On JSON parse failure: treats body as `{}`.
    - If either field is missing: `400` with same error and `required` list.
  - Fetches user via `authRepository.getUserByUsername(tenant.id, username)`:
    - On DB error: logs and returns `500` with `{ error: 'Database error occurred' }`.
    - If not found: `404` with `{ error: 'User not found' }`.
  - Applies rate limiting via `authRepository.checkChallengeRateLimit(tenant.id, user.id)`:
    - On disallowed result: `429` with `{ error: 'Rate limit exceeded', retryAfter }`.
  - Generates challenge using the same algorithm:
    - `generateSophisticatedChallenge()` uses `crypto` and `JWT_SECRET` (or fallback) to compute `fullChallenge` and `clientChallenge`.
  - Creates auth challenge via `authRepository.createAuthChallenge(tenant.id, user.id, challenge.fullChallenge, expiresAt, clientTimestampDate)`:
    - `expiresAt` is 5 minutes from now.
    - `clientTimestampDate` derived from `clientTimestamp` if provided.
    - On DB error: `500` with `{ error: 'Database error during challenge creation' }`.
  - On success:
    - Returns `200` with:
      - `{ challenge: clientChallenge, expiresAt: expiresAt.toISOString(), challengeId, tenant: tenant.displayName }`.
  - On outer error:
    - Logs `"Internal error in RequestChallenge"` and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: default v3 route (likely `/api/funcRequestChallenge`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["post"]`.
- **New**:
  - Route: `auth/request-challenge` (accessed as `/api/auth/request-challenge`).
  - Binding: declared via:
    - `app.http("RequestChallenge", { methods: ["POST"], authLevel: "function", route: "auth/request-challenge", handler: authRequestChallengeHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and access validation.
  - Required fields and associated validation messaging.
  - User lookup, rate limiting, and challenge creation logic.
  - Challenge structure and signing using the JWT secret or fallback.
- **Differences / clarifications**:
  - Request body parsing uses v4 `request.json()` but behaves as before for valid JSON inputs.
  - Route is explicitly under the `auth/` namespace.
- **Edge cases**:
  - Invalid or missing JSON body leads to the same missing-field checks as in v3.
  - If rate limiting DB query fails inside `checkChallengeRateLimit`, the repository returns a permissive result (per its implementation), keeping behavior consistent.

### Testing considerations

- Integration tests should:
  - First create a passwordless user (or ensure an existing one) and then call:
    - `POST /api/auth/request-challenge` with JSON `{ "username": "...", "clientTimestamp": "..." }`.
  - Validate success responses:
    - `200` with body containing:
      - `challenge` (nonce:timestamp format),
      - `expiresAt` (ISO string),
      - `challengeId` (number),
      - `tenant` (display name).
  - Exercise error responses:
    - Missing fields → `400`.
    - Unknown user → `404`.
    - Rate limit exceeded → `429` with `retryAfter`.
    - DB failures → `500`.
- Unit tests can:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.getUserByUsername`, `authRepository.checkChallengeRateLimit`, and `authRepository.createAuthChallenge` to cover all branches.

### Known limitations / TODOs

- Challenge format and signing are tightly coupled to `JWT_SECRET`; future refactors may want a dedicated challenge secret to separate concerns.
- Client-side handling of `retryAfter` and challenge expiration is outside the scope of this function and should be implemented in the caller.
