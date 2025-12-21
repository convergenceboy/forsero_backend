## GetWidgets Conversion Report

### Function overview

- **Original name**: `funcGetWidgets`
- **Category**: `user` / widgets
- **Purpose**: Return the list of available (not yet installed) widgets for a given user within a tenant.

### Original v3 implementation summary

- **Location**: `/backend/funcGetWidgets/index.js`
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
  - Enforces that callers can only access their own data:
    - If `auth.user_id && parseInt(auth.user_id) !== parseInt(user_id)`: returns `403` with `{ error: 'Unauthorized - can only access your own data' }`.
  - Retrieves available widgets via `widgetRepository.getAvailableWidgetsForUser(tenant.id, user_id)`:
    - On success: returns `200` with body `{ widgets: availableWidgets, tenant: tenant.displayName }`.
    - On failure: returns `500` with `{ error: 'Failed to retrieve available widgets' }`.
  - On outer error: returns `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/user/get-widgets.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `GetWidgets`.
- **Route**: `user/get-widgets` (called as `/api/user/get-widgets` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `userGetWidgetsHandler`.
  - Returns `HttpResponseInit` (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization and tenant resolution/access validation semantics from v3.
  - Authenticates via `authRepository.extractAuthFromRequest` with normalized headers:
    - Converts v4 `request.headers` (Headers-like) into a plain `{ headers: ... }` structure expected by the repository.
    - On failure: logs a warning and returns `401` with `{ error: 'Authentication required' }`.
  - Parses the request body via `await request.json()` while also reading `user_id` from the query string for backward compatibility:
    - `userId` is chosen from `request.query.get('user_id')` or `body.user_id`.
    - If `userId` is missing: returns `400` with `{ error: 'Missing user_id' }`.
  - Enforces self-only access semantics:
    - If `auth.user_id && parseInt(auth.user_id, 10) !== parseInt(String(userId), 10)`: returns `403` with `{ error: 'Unauthorized - can only access your own data' }`.
  - Retrieves available widgets via `widgetRepository.getAvailableWidgetsForUser(tenant.id, userId)`:
    - On DB/service error: logs and returns `500` with `{ error: 'Failed to retrieve available widgets' }`.
    - On success: returns `200` with `jsonBody` `{ widgets: availableWidgets, tenant: tenant.displayName }`.
  - On outer error: logs `"Internal error in GetWidgets"` and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: default v3 route (e.g. `/api/funcGetWidgets`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["get", "post"]`.
- **New**:
  - Route: `user/get-widgets` (accessed as `/api/user/get-widgets`).
  - Binding: declared via:
    - `app.http('GetWidgets', { methods: ['POST'], authLevel: 'function', route: 'user/get-widgets', handler: userGetWidgetsHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and read-access validation.
  - Authentication requirement and self-only access semantics.
  - Required `user_id` and associated error messaging.
  - Delegation to `widgetRepository.getAvailableWidgetsForUser` with tenant scoping.
  - Success and error response shapes and status codes.
- **Differences / clarifications**:
  - v4 implementation supports only `POST` (no `GET`) for the new route, but still honors `user_id` from either query or body.
  - Uses v4 `request.json()` and header normalization; behavior is equivalent for JSON clients.
- **Edge cases**:
  - If `user_id` is provided in both query and body, the query value takes precedence.
  - If the repository returns an empty list, the function still returns `200` with `widgets: []`.

### Testing considerations

- **Integration tests should**:
  - Register a passwordless user, obtain a JWT, and call `POST /api/user/get-widgets` with:
    - Headers: `Authorization: Bearer <jwt>`, tenant headers, and function key.
    - Body: `{ "user_id": <authUserId> }` (or use a `user_id` query parameter).
  - Verify:
    - Status `200` and body containing `widgets` (array) and `tenant`.
  - Exercise error paths:
    - Missing `user_id` → `400`.
    - Missing/invalid token → `401`.
    - Mismatched `user_id` → `403`.
    - Simulated repository errors → `500` with `{ error: 'Failed to retrieve available widgets' }`.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, and `widgetRepository.getAvailableWidgetsForUser` to cover all branches.

### Known limitations / TODOs

- The function assumes that `widgetRepository.getAvailableWidgetsForUser` correctly filters out installed widgets and applies any business rules; that logic is outside the scope of this orchestration layer.
- Common auth/tenant orchestration logic is duplicated across user functions and could be refactored into shared utilities in future refactors.
