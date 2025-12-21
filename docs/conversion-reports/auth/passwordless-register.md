## PasswordlessRegister Conversion Report

### Function overview

- **Original name**: `funcPasswordlessRegister`
- **Category**: `auth` / passwordless registration
- **Purpose**: Register new passwordless user accounts with multi-tenant support, store public keys and profile data, and return a JWT for authentication.

### Original v3 implementation summary

- **Location**: `/backend/funcPasswordlessRegister/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `POST`, `authLevel: function`).
- **Behavior**:
  - Imports `jwt` directly and uses an environment or fallback JWT secret.
  - Calls `initializeApp()` from `services/serviceInit.js`, logging a warning if initialization fails but continuing execution.
  - Resolves tenant via `resolveTenant(req)` and validates access with `validateTenantAccess(tenant, 'write')`:
    - On access denied: returns `403` with JSON `{ error: 'Tenant access denied' }`.
  - On tenant resolution/validation failure:
    - Returns `400` with `{ error: 'Invalid tenant configuration' }`.
  - Reads `username` and `publicKey` from `req.body`:
    - If missing: returns `400` with `{ error: 'Missing required fields', required: ['username', 'publicKey'] }`.
  - Validates the username format with regex `/^[a-zA-Z0-9_-]{3,20}$/`:
    - If invalid: returns `400` with `{ error: 'Username must be 3-20 characters, letters, numbers, underscore, or dash only' }`.
  - Checks username availability via `authRepository.checkUsernameAvailability(tenant.id, username)`:
    - On DB error: returns `500` with `{ error: 'Database error during username check' }`.
    - If not available: returns `409` with `{ error: 'Username already taken' }`.
  - Creates a new passwordless user with `authRepository.createPasswordlessUser(tenant.id, username, publicKey)`:
    - On DB error: returns `500` with `{ error: 'Database error during registration' }`.
  - Generates a JWT using:
    - Secret: `process.env.JWT_SECRET` or fallback `'your-super-secret-jwt-key-change-in-production-make-it-long-and-random'`.
    - Payload: `{ user_id, username, tenant_id, tenantKey, type: 'passwordless' }`.
    - Expires in `24h`.
  - On success:
    - Returns `201` with body:
      - `{ success: true, token, user: { user_id, username, registrationDate, tenant }, message: 'Passwordless account created successfully' }`.
  - On outer error:
    - If `error.code === '23505'` (PostgreSQL unique violation) → `409` with `{ error: 'Username already taken' }`.
    - Otherwise → `500` with `{ error: 'Registration failed' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/auth/passwordless-register.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `PasswordlessRegister`.
- **Route**: `auth/passwordless-register` (called as `/api/auth/passwordless-register` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `authPasswordlessRegisterHandler`.
  - Returns `HttpResponseInit` objects (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization via `initializeApp()` with warnings on failure.
  - Resolves tenant with `resolveTenant(request)` and validates `validateTenantAccess(tenant, 'write')`:
    - Access denied → `403` with `{ error: 'Tenant access denied' }`.
    - Resolution/validation failure → `400` with `{ error: 'Invalid tenant configuration' }`.
  - Reads body via `await request.json()` and extracts `username` and `publicKey`:
    - On parse failure: treats body as `{}` and falls back to field checks.
    - Missing fields → `400` with same error/required list.
  - Validates username using the same regex and error message.
  - Checks availability via `authRepository.checkUsernameAvailability(tenant.id, username)`:
    - On DB error: logs and returns `500` with `{ error: 'Database error during username check' }`.
    - If not available: returns `409` with `{ error: 'Username already taken' }`.
  - Creates a new passwordless user via `authRepository.createPasswordlessUser`:
    - On DB error: logs and returns `500` with `{ error: 'Database error during registration' }`.
  - Generates JWT using `jsonwebtoken` with:
    - Secret: `process.env.JWT_SECRET` or same fallback string as v3.
    - Payload: `{ user_id, username, tenant_id, tenantKey, type: 'passwordless' }`.
    - Expiration: `24h`.
  - On success:
    - Returns `201` with `jsonBody`:
      - `{ success: true, token, user: { user_id, username, registrationDate, tenant }, message: 'Passwordless account created successfully' }`.
  - On outer error:
    - If `error.code === '23505'` → `409` with `{ error: 'Username already taken' }`.
    - Else: `500` with `{ error: 'Registration failed' }`.

### Route and binding changes

- **Original**:
  - Route: default v3 route (likely `/api/funcPasswordlessRegister`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["post"]`.
- **New**:
  - Route: `auth/passwordless-register` (accessed as `/api/auth/passwordless-register`).
  - Binding: declared via:
    - `app.http("PasswordlessRegister", { methods: ["POST"], authLevel: "function", route: "auth/passwordless-register", handler: authPasswordlessRegisterHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and write-access check.
  - Username and public key validation, including format and required fields.
  - Username availability checks and related error codes.
  - JWT payload contents and expiration semantics.
  - Distinct handling for unique constraint violations vs other errors.
- **Differences / clarifications**:
  - Request body parsing uses the v4 `request.json()` API but maintains equivalent behavior for valid JSON clients.
  - Route is now explicitly under the `auth/` namespace.
- **Edge cases**:
  - If `request.json()` fails (invalid JSON), the handler still validates and responds based on field presence.
  - If the database is temporarily unavailable, callers receive a `500` with a clear message indicating the stage (username check vs registration).

### Testing considerations

- Integration tests should:
  - Call `POST /api/auth/passwordless-register` with JSON `{ "username": "...", "publicKey": "..." }` and appropriate tenant headers.
  - Verify:
    - `201` status on successful new user registration.
    - Response body includes:
      - `success: true`, `token: string`, `user: { user_id, username, registrationDate, tenant }`, and a success `message`.
  - Exercise error paths:
    - Missing fields.
    - Invalid username format.
    - Username collision (`409`).
    - Simulated DB errors (during username check and user creation).
- Unit tests can:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.checkUsernameAvailability`, `authRepository.createPasswordlessUser`, and `jwt.sign` to control all branches.

### Known limitations / TODOs

- Token generation is still handled manually using `jsonwebtoken` and a fallback secret; future refactors could centralize this via `AuthRepository.getJwtSecret` / `generateToken` while maintaining compatibility.
- Public key validation is minimal (presence and type only); additional format or length checks may be desirable for security.
