## VerifyChallenge Conversion Report

### Function overview

- **Original name**: `funcVerifyChallenge`
- **Category**: `auth` / passwordless verification
- **Purpose**: Verify a signed authentication challenge for passwordless login with multi-tenant support, mark the challenge as used, issue a JWT, and return an HMAC key for interest hashing.

### Original v3 implementation summary

- **Location**: `/backend/funcVerifyChallenge/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Behavior**:
  - Initializes services via `initializeApp()` (non-fatal; ignores initialization failures).
  - Resolves tenant via `resolveTenant(req)` and validates access with `validateTenantAccess(tenant, 'read')`:
    - On access denied: `403` with `{ error: 'Tenant access denied' }`.
    - On resolution/validation failure: `400` with `{ error: 'Invalid tenant configuration' }`.
  - Reads `{ challengeId, signature }` from `req.body`:
    - If missing: `400` with `{ error: 'Missing required fields', required: ['challengeId', 'signature'] }`.
  - Looks up the stored challenge and associated user via `authRepository.getChallengeWithUser(tenant.id, challengeId)`:
    - On DB error: `500` with `{ error: 'Database error occurred' }`.
    - If no record: `404` with `{ error: 'Invalid challenge' }`.
  - Enforces challenge expiry and single-use semantics:
    - If current time is past `expires_at`: `401` with `{ error: 'Challenge expired' }`.
    - If `used_at` is already set: `401` with `{ error: 'Challenge already used' }`.
  - Lazily imports `getSecret` from `services/serviceSecrets.js`.
  - Verifies the ECDSA P-256 signature using a noble-based `verifySignature` helper:
    - Accepts stored challenge string `"nonce:timestamp[:serverSig]"` and reconstructs the client-visible `"nonce:timestamp"`.
    - Accepts compact signature hex (R||S, 128 hex chars) and compressed/uncompressed public keys (66 or 130 hex chars).
    - Hashes `clientChallenge` with `sha256` and verifies using `p256.verify`.
    - Returns `401` `{ error: 'Invalid signature' }` when verification fails.
  - Marks the challenge as used via `authRepository.markChallengeAsUsed(tenant.id, challengeId)` (best-effort; ignores errors).
  - Generates a JWT via `authRepository.generateToken(user_id, emailOrSynthetic, username, tenant.id)`:
    - On failure: `500` with `{ error: 'Token generation failed' }`.
  - Retrieves an HMAC secret key via `getSecret('HMAC_SECRET_KEY')`.
  - On success:
    - Returns `200` with body:
      - `{ success: true, token, user: { user_id, username, tenant }, "HMAC-SECRET-KEY": hmacKey, message: 'Authentication successful' }`.
  - On outer error:
    - Returns `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/auth/verify-challenge.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `VerifyChallenge`.
- **Route**: `auth/verify-challenge` (called as `/api/auth/verify-challenge` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `authVerifyChallengeHandler`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
  - Imports `getSecret` statically from `services/serviceSecrets.js` instead of dynamically.
- **Logic**:
  - Preserves initialization via `initializeApp()` with warnings on failure.
  - Resolves tenant via `resolveTenant(request)` and validates `validateTenantAccess(tenant, 'read')`:
    - Access denied → `403` with `{ error: 'Tenant access denied' }`.
    - Resolution/validation failure → logs warning and returns `400` with `{ error: 'Invalid tenant configuration' }`.
  - Reads body via `await request.json()` and extracts `challengeId` and `signature`:
    - On parse failure: treats body as `{}` and falls back to presence checks.
    - Missing `challengeId` or `signature` → `400` with `{ error: 'Missing required fields', required: ['challengeId', 'signature'] }`.
  - Fetches challenge and user via `authRepository.getChallengeWithUser(tenant.id, challengeId)`:
    - On DB error: logs and returns `500` with `{ error: 'Database error occurred' }`.
    - Missing record: `404` with `{ error: 'Invalid challenge' }`.
  - Enforces expiry and single-use:
    - Past `expires_at` → `401` with `{ error: 'Challenge expired' }`.
    - `used_at` present → `401` with `{ error: 'Challenge already used' }`.
  - Verifies the signature via a ported `verifySignature` helper using `@noble/curves/p256` and `@noble/hashes`:
    - Performs basic presence checks and structural validation for signature and public key.
    - Reconstructs `clientChallenge` from stored `"nonce:timestamp[:serverSig]"` and computes `sha256(clientChallenge)`.
    - Uses `p256.Signature.fromCompact` and `p256.verify` against the digest and public key bytes.
    - On failure: returns `401` with `{ error: 'Invalid signature' }`.
  - Marks the challenge as used via `authRepository.markChallengeAsUsed(tenant.id, challengeId)`:
    - Logs a warning on failure but does not change the response.
  - Generates a JWT via `authRepository.generateToken` with the same payload semantics as v3:
    - On error: logs and returns `500` with `{ error: 'Token generation failed' }`.
  - Retrieves the HMAC key via `getSecret('HMAC-SECRET-KEY')`.
  - On success:
    - Returns `200` with `jsonBody`:
      - `{ success: true, token, user: { user_id, username, tenant }, "HMAC-SECRET-KEY": hmacKey, message: 'Authentication successful' }`.
  - On outer error:
    - Logs `"Internal error in VerifyChallenge"` and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: default v3 route (likely `/api/funcVerifyChallenge`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["post"]`.
- **New**:
  - Route: `auth/verify-challenge` (accessed as `/api/auth/verify-challenge`).
  - Binding: declared via:
    - `app.http('VerifyChallenge', { methods: ['POST'], authLevel: 'function', route: 'auth/verify-challenge', handler: authVerifyChallengeHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and read-access validation.
  - Required field validation for `challengeId` and `signature`.
  - Challenge lookup, expiry, and single-use semantics.
  - Signature verification algorithm and public key constraints.
  - Token generation via `authRepository.generateToken` and retrieval of `HMAC-SECRET-KEY`.
  - Response shape on success and common error paths (400/401/403/404/500).
- **Differences / clarifications**:
  - Uses the v4 `request.json()` API to parse the body but maintains equivalent validation for clients sending proper JSON.
  - `getSecret` is now imported statically from `services/serviceSecrets.js`, which is consistent with the v4 `GetHealth` function.
  - Logging is slightly richer (warn/error logs for tenant resolution, DB failures, token generation, and outer errors).
- **Edge cases**:
  - Invalid JSON bodies are treated as empty objects and still go through required-field validation.
  - Signature/public key values that do not conform to expected hex shape are rejected early with `401`.
  - Failures when marking the challenge as used do not prevent successful authentication but are logged for observability.

### Testing considerations

- **Integration tests should**:
  - Register a passwordless user and ensure their public key is stored (e.g., via `POST /api/auth/passwordless-register`).
  - Request a challenge via `POST /api/auth/request-challenge` and capture `{ challenge, challengeId }`.
  - Sign the returned `challenge` using the user's private P-256 key with the same scheme as the client/frontend (SHA-256 + compact ECDSA):
    - `digest = sha256(utf8ToBytes(challenge))` → sign with `p256.sign(digest, privateKeyBytes)` → hex encode.
  - Call `POST /api/auth/verify-challenge` with `{ challengeId, signature }` and verify that:
    - Status is `200` and body includes `success: true`, `token`, `user`, `"HMAC-SECRET-KEY"`, and a success `message`.
  - Exercise error responses:
    - Missing fields → `400`.
    - Invalid or expired challenge → `401` or `404` depending on state.
    - Incorrect signature → `401` with `{ error: 'Invalid signature' }`.
    - Simulated DB or token generation failures → `500` with appropriate error messages.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.getChallengeWithUser`, `authRepository.markChallengeAsUsed`, `authRepository.generateToken`, and `getSecret` to cover all branches and error paths.

### Known limitations / TODOs

- The function trusts the stored `public_key` from the database and only validates its basic shape; stronger key validation or rotation strategies could be implemented in the future.
- The same HMAC key (`HMAC-SECRET-KEY`) is reused for all tenants and derived per-tenant on the client; a future enhancement might provide per-tenant secrets directly from the backend.
- The signature verification helper is duplicated from the v3 implementation; future refactors could centralize it into a shared crypto utility used by both v3 (if still present) and v4 implementations.
