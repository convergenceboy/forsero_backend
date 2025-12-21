## GetUserWidgets Conversion Report

### Function overview

- **Original name**: `funcGetUserWidgets`
- **Category**: `user` / widgets
- **Purpose**: Return the list of installed widgets (and their order/config) for a given user within a tenant.

### Original v3 implementation summary

- **Location**: `/backend/funcGetUserWidgets/index.js`
- **Trigger**: HTTP (`httpTrigger`, methods: `GET`, `POST`, `authLevel: function`).
- **Behavior**:
  - Initializes services via `initializeApp()` and logs warnings on failure without aborting.
  - Resolves tenant via `resolveTenant(req)` and validates `validateTenantAccess(tenant, 'read')`:
    - If access is denied: returns `403` with `{ error: 'Tenant access denied' }`.
    - If tenant resolution/validation fails: returns `400` with `{ error: 'Invalid tenant domain' }`.
  - Authenticates via `authRepository.extractAuthFromRequest(req)`:
    - On failure: returns `401` with `{ error: 'Authentication required' }`.
  - Reads `user_id` from `req.query.user_id` or `req.body.user_id`:
    - If missing: returns `400` with `{ error: 'Missing user_id' }`.
  - Enforces that callers can only access their own widgets:
    - If `auth.user_id && parseInt(auth.user_id) !== parseInt(user_id)`: returns `403` with `{ error: 'Unauthorized - can only access your own widgets' }`.
  - Retrieves installed widgets via `widgetRepository.getUserWidgets(tenant.id, user_id)`:
    - On success: returns `200` with body `{ widgets, tenant: tenant.displayName }`.
    - On failure: returns `500` with `{ error: 'Failed to retrieve user widgets' }`.
  - On outer error: returns `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/user/get-user-widgets.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `GetUserWidgets`.
- **Route**: `user/get-user-widgets` (called as `/api/user/get-user-widgets` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `userGetUserWidgetsHandler`.
  - Returns `HttpResponseInit` (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization and tenant resolution/access validation semantics from v3.
  - Authenticates via `authRepository.extractAuthFromRequest` with normalized headers:
    - Converts v4 `request.headers` (Headers-like) into a plain object `{ headers: ... }` expected by the repository.
    - On failure: logs a warning and returns `401` with `{ error: 'Authentication required' }`.
  - Parses the request body via `await request.json()` while also reading `user_id` from the query string for backward compatibility:
    - `userId` is chosen from `request.query.get('user_id')` or `body.user_id`.
    - If `userId` is missing: returns `400` with `{ error: 'Missing user_id' }`.
  - Enforces self-only access semantics:
    - If `auth.user_id && parseInt(auth.user_id, 10) !== parseInt(String(userId), 10)`: returns `403` with `{ error: 'Unauthorized - can only access your own widgets' }`.
  - Retrieves installed widgets via `widgetRepository.getUserWidgets(tenant.id, userId)`:
    - On DB/service error: logs and returns `500` with `{ error: 'Failed to retrieve user widgets' }`.
    - On success: returns `200` with `jsonBody` `{ widgets, tenant: tenant.displayName }`.
  - On outer error: logs `"Internal error in GetUserWidgets"` and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: default v3 route (e.g. `/api/funcGetUserWidgets`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["get", "post"]`.
- **New**:
  - Route: `user/get-user-widgets` (accessed as `/api/user/get-user-widgets`).
  - Binding: declared via:
    - `app.http('GetUserWidgets', { methods: ['POST'], authLevel: 'function', route: 'user/get-user-widgets', handler: userGetUserWidgetsHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and read-access validation.
  - Authentication requirement and self-only access semantics.
  - Required `user_id` and associated error messaging.
  - Delegation to `widgetRepository.getUserWidgets` with tenant scoping.
  - Success and error response shapes and status codes.
- **Differences / clarifications**:
  - v4 implementation supports only `POST` (no `GET`) for the new route, but still honors `user_id` from either query or body for backward compatibility.
  - Uses v4 `request.json()` and header normalization; behavior is equivalent for JSON clients.
- **Edge cases**:
  - If `user_id` is provided in both query and body, the query value takes precedence.
  - If the repository returns an empty list, the function still returns `200` with `widgets: []`.

### Testing considerations

- **Integration tests should**:
  - Register a passwordless user, obtain a JWT, and call `POST /api/user/get-user-widgets` with:
    - Headers: `Authorization: Bearer <jwt>`, tenant headers, and function key.
    - Body: `{ "user_id": <authUserId> }` (or use a `user_id` query parameter).
  - Verify:
    - Status `200` and body containing `widgets` (array) and `tenant`.
  - Exercise error paths:
    - Missing `user_id` → `400`.
    - Missing/invalid token → `401`.
    - Mismatched `user_id` → `403`.
    - Simulated repository errors → `500` with `{ error: 'Failed to retrieve user widgets' }`.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, and `widgetRepository.getUserWidgets` to cover all branches.

### Known limitations / TODOs

- The function assumes that `widgetRepository.getUserWidgets` correctly reflects the installed widgets and their configuration; that logic is outside the scope of this orchestration layer.
- Common auth/tenant orchestration logic is duplicated across user functions and could be refactored into shared utilities in future refactors.
