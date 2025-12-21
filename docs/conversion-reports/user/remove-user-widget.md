## RemoveUserWidget Conversion Report

### Function overview

- **Original name**: `funcRemoveUserWidget`
- **Category**: `user` / widgets
- **Purpose**: Remove a widget from a user's dashboard within a tenant.

### Original v3 implementation summary

- **Location**: `/backend/funcRemoveUserWidget/index.js`
- **Trigger**: HTTP (`httpTrigger`, methods: `POST`, `authLevel: function`).
- **Behavior**:
  - Initializes services via `initializeApp()` and logs warnings on failure without aborting.
  - Resolves tenant via `resolveTenant(req)` and validates `validateTenantAccess(tenant, 'write')`:
    - If access is denied: sets `403` with `{ error: 'Tenant access denied' }`.
    - If tenant resolution/validation fails: sets `400` with `{ error: 'Invalid tenant domain' }`.
  - Authenticates via `authRepository.extractAuthFromRequest(req)`:
    - On failure: sets `401` with `{ error: 'Authentication required' }`.
  - Reads `{ user_id, widgetKey }` from `req.body`:
    - If `!user_id || !widgetKey`: sets `400` with `{ error: 'Missing user_id or widgetKey' }`.
  - Enforces that callers can only remove widgets from their own dashboard via `authRepository.validateUserOwnership(auth.user_id, user_id)`:
    - On failure: sets `403` with `{ error: ownershipError.message }`.
  - Removes the widget via `widgetRepository.removeUserWidget(tenant.id, user_id, widgetKey)`:
    - On DB/service error: sets `500` with `{ error: 'Failed to remove widget' }`.
    - On success `false` (no rows deleted): sets `404` with `{ error: 'Widget not found or already removed' }`.
    - On success `true`: sets `200` with `{ success: true, message: 'Widget removed successfully', tenant: tenant.displayName }`.
  - On outer error: sets `500` with `{ error: 'Internal server error' }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/user/remove-user-widget.js`
- **Trigger**: HTTP (via `app.http`, method: `POST`, `authLevel: function`).
- **Azure Function name**: `RemoveUserWidget`.
- **Route**: `user/remove-user-widget` (called as `/api/user/remove-user-widget` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `userRemoveUserWidgetHandler`.
  - Returns `HttpResponseInit` (`status`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves initialization and tenant resolution/access validation semantics from v3.
  - Authenticates via `authRepository.extractAuthFromRequest` with normalized headers:
    - Converts v4 `request.headers` (Headers-like) into a plain object `{ headers: ... }` expected by the repository.
    - On failure: logs a warning and returns `401` with `{ error: 'Authentication required' }`.
  - Parses the request body via `await request.json()` and destructures `{ user_id, widgetKey }`:
    - If `!user_id || !widgetKey`: returns `400` with `{ error: 'Missing user_id or widgetKey' }`.
  - Enforces self-only access semantics using `authRepository.validateUserOwnership(auth.user_id, user_id)`:
    - On failure: returns `403` with `{ error: ownershipError.message }`.
  - Removes the widget via `widgetRepository.removeUserWidget(tenant.id, user_id, widgetKey)`:
    - On DB/service error: logs and returns `500` with `{ error: 'Failed to remove widget' }`.
    - If `success === false`: returns `404` with `{ error: 'Widget not found or already removed' }`.
    - If `success === true`: returns `200` with `{ success: true, message: 'Widget removed successfully', tenant: tenant.displayName }`.
  - On outer error: logs `"Error in RemoveUserWidget"` and returns `500` with `{ error: 'Internal server error' }`.

### Route and binding changes

- **Original**:
  - Route: default v3 route (e.g. `/api/funcRemoveUserWidget`).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["post"]`.
- **New**:
  - Route: `user/remove-user-widget` (accessed as `/api/user/remove-user-widget`).
  - Binding: declared via:
    - `app.http('RemoveUserWidget', { methods: ['POST'], authLevel: 'function', route: 'user/remove-user-widget', handler: userRemoveUserWidgetHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Tenant resolution and write-access validation.
  - Authentication requirement and self-only access semantics.
  - Required `user_id` and `widgetKey` validation and associated error messaging.
  - Delegation to `widgetRepository.removeUserWidget` with tenant scoping.
  - Success, 404-not-found, and error response shapes and status codes.
- **Differences / clarifications**:
  - Uses v4 `request.json()` and header normalization; behavior is equivalent for JSON clients.
  - Returns responses via `HttpResponseInit` instead of mutating `context.res`.
- **Edge cases**:
  - If the repository returns `false`, the function responds with `404` and `{ error: 'Widget not found or already removed' }`.
  - If the repository throws due to validation or DB errors, the function responds with `500` and `{ error: 'Failed to remove widget' }`.

### Testing considerations

- **Integration tests should**:
  - Register a passwordless user, obtain a JWT, optionally add a widget, and call `POST /api/user/remove-user-widget` with:
    - Headers: `Authorization: Bearer <jwt>`, tenant headers, and function key.
    - Body: `{ "user_id": <authUserId>, "widgetKey": "<widgetKey>" }`.
  - Verify:
    - On success: status `200` and body containing `success: true`, `message`, and `tenant`.
    - On not-found: status `404` with `{ error: 'Widget not found or already removed' }`.
- **Unit tests can**:
  - Mock `initializeApp`, `resolveTenant`, `validateTenantAccess`, `authRepository.extractAuthFromRequest`, `authRepository.validateUserOwnership`, and `widgetRepository.removeUserWidget` to cover all branches.

### Known limitations / TODOs

- The function assumes that `widgetRepository.removeUserWidget` correctly indicates whether a widget was removed; that logic is outside the scope of this orchestration layer.
- Common auth/tenant orchestration logic is duplicated across user functions and could be refactored into shared utilities in future refactors.
