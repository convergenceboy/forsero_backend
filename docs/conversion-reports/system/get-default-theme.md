## GetDefaultTheme Conversion Report

### Function overview

- **Original name**: `funcGetDefaultTheme`
- **Category**: `system` / system configuration
- **Purpose**: Return the default theme configuration from system configuration storage.

### Original v3 implementation summary

- **Location**: `/backend/funcGetDefaultTheme/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `GET`, `authLevel: anonymous`).
- **Behavior**:
  - Defines simple CORS headers:
    - `Access-Control-Allow-Origin: *`
    - `Access-Control-Allow-Methods: GET, OPTIONS`
    - `Access-Control-Allow-Headers: Content-Type, Authorization`
  - Uses `tenantRepository.getDefaultTheme()` to retrieve the default theme configuration.
  - On success:
    - Responds with `200` and:
      - Headers: `Content-Type: application/json` plus the CORS headers.
      - Body: `defaultTheme` (whatever is returned by the repository).
  - On failure:
    - Logs the error.
    - Responds with `500` and:
      - Headers: `Content-Type: application/json` plus the CORS headers.
      - Body: `{ error: 'Failed to get default theme', details: error.message }`.

### v4 implementation summary

- **Location**: `/backend-v4/functions/system/get-default-theme.js`
- **Trigger**: HTTP (via `app.http`, method: `GET`, `authLevel: anonymous`).
- **Azure Function name**: `GetDefaultTheme`.
- **Route**: `system/get-default-theme` (called as `/api/system/get-default-theme` by default).
- **Structure changes**:
  - Uses the v4 `app.http` registration model with handler `systemGetDefaultThemeHandler`.
  - Returns `HttpResponseInit` objects (`status`, `headers`, `jsonBody`) instead of mutating `context.res`.
- **Logic**:
  - Preserves the CORS headers and `Content-Type` as in v3.
  - Calls `tenantRepository.getDefaultTheme()` to fetch the configuration.
  - On success:
    - Returns `200` with:
      - Headers: `Content-Type: application/json` plus CORS headers.
      - `jsonBody: defaultTheme`.
  - On failure:
    - Logs the error via `context.log.error`.
    - Returns `500` with:
      - Headers: `Content-Type: application/json` plus CORS headers.
      - `jsonBody: { error: 'Failed to get default theme', details: error.message }`.

### Route and binding changes

- **Original**:
  - Route: implicit v3 route (likely `/api/funcGetDefaultTheme`).
  - Binding: `httpTrigger` + `http` output, `authLevel: anonymous`, `methods: ["get"]`.
- **New**:
  - Route: `system/get-default-theme` (accessed as `/api/system/get-default-theme`).
  - Binding: declared via:
    - `app.http("GetDefaultTheme", { methods: ["GET"], authLevel: "anonymous", route: "system/get-default-theme", handler: systemGetDefaultThemeHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - CORS and content-type headers identical to v3.
  - Success and error response shapes, including `details: error.message` on failure.
  - Anonymous access to the endpoint.
- **Differences / clarifications**:
  - Route is explicitly namespaced under `system/`, improving consistency with other v4 system endpoints.
  - Logging uses `context.log?.error` with optional chaining, but the semantics are equivalent.
- **Edge cases**:
  - If `tenantRepository.getDefaultTheme()` returns `null`, the endpoint responds with `200` and a `null` JSON body, matching repository behavior.

### Testing considerations

- Integration tests should:
  - Call `GET /api/system/get-default-theme` without authentication.
  - Expect a `200` status and JSON response (object or `null`), plus the expected CORS headers.
  - Optionally verify behavior when no default theme is configured (e.g., `null` result).
- Unit tests can:
  - Mock `tenantRepository.getDefaultTheme()` to simulate both successful and failing paths.

### Known limitations / TODOs

- The endpoint currently returns the entire theme configuration as stored; if any sensitive or internal configuration is added to `default_theme`, it may need filtering before being returned.
- CORS policy is permissive (`*`); this may need to be tightened for some deployments.
