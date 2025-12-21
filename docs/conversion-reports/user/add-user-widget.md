## AddUserWidget Conversion Report

### Function overview

- **Original name**: `funcAddUserWidget`
- **Category**: `user` / widgets
- **Purpose**: Add a widget to a user's dashboard within a tenant.

### Original v3 implementation summary

- **Location**: `/backend/funcAddUserWidget/index.js`
- **Trigger**: HTTP (`httpTrigger`, methods: `POST`, `authLevel: function`).
- **Behavior**:
  - Initializes services via `initializeApp()` and logs warnings on failure without aborting.
  - Resolves tenant via `resolveTenant(req)` and validates `validateTenantAccess(tenant, 'write')`:
    - If access is denied: sets `403` with `{ error: 'Tenant access denied' }`.
    - If tenant resolution/validation fails: sets `400` with `{ error: 'Invalid tenant domain' }`.
  - Authenticates via `authRepository.extractAuthFromRequest(req)`:
    - On failure: sets `401` with `{ error: 'Authentication required' }`.
  - Reads `{ user_id, widgetKey, position = 0, config = null }` from `req.body`:
    - If `!user_id || !widgetKey`: sets `400` with `{ error: 'Missing user_id or widgetKey' }`.
  - Enforces that callers can only add widgets to their own dashboard via `authRepository.validateUserOwnership(auth.user_id, user_id)`:
    - On failure: sets `403` with `{ error: ownershipError.message }`.
  - Adds the widget via `widgetRepository.addUserWidget(tenant.id, user_id, widgetKey, position, config)`:
    - On DB/service error: sets `500` with `{ error: 'Failed to add widget' }`.
    - On success: sets `200` with `{ success: true, message: 'Widget added successfully', tenant: tenant.displayName }`.
  - On outer error: logs and sets `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/user/add-user-widget.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `AddUserWidget`.
- **Route**: `user/add-user-widget` (called as `/api/user/add-user-widget` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `userAddUserWidgetHandler`.
  - Returns `HttpResponseInit` (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization and tenant resolution/access validation semantics from v3.
  - Authenticates via `authRepository.extractAuthFromRequest` with normalized headers:
    - Converts v4 `request.headers` (Headers-like) into a plain object `{ headers: ... }` expected by the repository.
    - On failure: logs a warning and returns `401` with `{ error: 'Authentication required' }`.
  - Parses the request body via `await request.json()` and destructures `{ user_id, widgetKey, position, config }`:
    - `position` defaults to `0` when omitted, matching v3 behavior.
    - If `!user_id || !widgetKey`: returns `400` with `{ error: 'Missing user_id or widgetKey' }`.
  - Enforces self-only access semantics using `authRepository.validateUserOwnership(auth.user_id, user_id)`:
    - On failure: returns `403` with `{ error: ownershipError.message }`.
  - Adds the widget via `widgetRepository.addUserWidget(tenant.id, user_id, widgetKey, position, config)`:
    - On DB/service error: logs and returns `500` with `{ error: 'Failed to add widget' }`.
    - On success: returns `200` with `jsonBody` `{ success: true, message: 'Widget added successfully', tenant: tenant.displayName }`.
  - On outer error: logs `"Error in AddUserWidget"` and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: default v3 route (e.g. `/api/funcAddUserWidget`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["post"]`.
- **New**:
  - Route: `user/add-user-widget` (accessed as `/api/user/add-user-widget`).
  - Binding: declared via:
    - `app.http('AddUserWidget', { methods: ['POST'], authLevel: 'function', route: 'user/add-user-widget', handler: userAddUserWidgetHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and write-access validation.
  - Authentication requirement and self-only access semantics.
  - Required `user_id` and `widgetKey` validation and associated error messaging.
  - Delegation to `widgetRepository.addUserWidget` with tenant scoping.
  - Success and error response shapes and status codes.
- **Differences / clarifications**:
  - Uses v4 `request.json()` and header normalization; behavior is equivalent for JSON clients.
  - Returns responses via `HttpResponseInit` instead of mutating `context.res`.
- **Edge cases**:
  - If `position` is omitted, it defaults to `0`.
  - If the repository throws due to validation or DB errors, the function responds with `500` and `{ error: 'Failed to add widget' }`.

### Testing considerations

- **Integration tests should**:
  - Register a passwordless user, obtain a JWT, and call `POST /api/user/add-user-widget` with:
    - Headers: `Authorization: Bearer <jwt>`, tenant headers, and function key.
    - Body: `{ "user_id": <authUserId>, "widgetKey": "<validWidgetKey>", "position": 0, "config": null }`.
  - Verify:
    - On success: status `200` and body containing `success: true`, `message`, and `tenant`.
  - Exercise error paths:
    - Missing `user_id` or `widgetKey` → `400`.
    - Missing/invalid token → `401`.
    - Unauthorized user (ownership check failure) → `403`.
    - Simulated repository errors → `500` with `{ error: 'Failed to add widget' }`.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, `authRepository.validateUserOwnership`, and `widgetRepository.addUserWidget` to cover all branches.

### Known limitations / TODOs

- The function assumes that `widgetRepository.addUserWidget` enforces widget existence and any business rules; that logic is outside the scope of this orchestration layer.
- Common auth/tenant orchestration logic is duplicated across user functions and could be refactored into shared utilities in future refactors.
