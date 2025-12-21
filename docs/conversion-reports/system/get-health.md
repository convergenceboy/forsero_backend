## GetHealth Conversion Report

### Function overview

- **Original name**: `funcGetHealth`
- **Category**: `system`
- **Purpose**: Verify resolution of secrets (Key Vault / environment), determine the source of `DATABASE_URL`, and test database connectivity from the Azure Function App environment.

### Original v3 implementation summary

- **Location**: `/backend/funcGetHealth/index.js`
- **Trigger**: HTTP (`httpTrigger`, method: `GET`, `authLevel: function`).
- **Behavior**:
  - Initializes the application via `initializeApp`.
  - Performs a **Key Vault health check** using `healthCheck` from `serviceSecrets.js`.
  - Retrieves:
    - `DATABASE_URL`
    - `HMAC_SECRET_KEY`
    - `JWT_SECRET`
    via `getSecret`.
  - Performs a **database health check** using `databaseHealthCheck` from `serviceDatabase.js`.
  - Determines the **source** of `DATABASE_URL`:
    - `azure-keyvault` if Key Vault client is initialized.
    - `environment-variable` if `process.env.DATABASE_URL` is set.
    - `local-secrets-fallback` if neither of the above and running in an Azure Functions environment.
    - `local-development` when not running in an Azure Functions environment.
  - Returns a JSON payload with:
    - Key Vault status and metadata.
    - Whether each secret was retrieved and its value (or `"Not available"`).
    - Database connection status, timestamp, pool statistics, and any error.

### v4 implementation summary

- **Location**: `/backend-v4/functions/system/get-health.js`
- **Trigger**: HTTP (via `app.http`, method: `GET`, `authLevel: function`).
- **Azure Function name**: `GetHealth`.
- **Route**: `system/get-health` (called as `/api/system/get-health` by default).
- **Structure changes**:
  - Uses the v4 **isolated worker** style with `app.http` registration.
  - Defines a separate handler function: `systemGetHealthHandler(_request, context)`.
  - Returns an `HttpResponseInit` object with `status` and `jsonBody` instead of mutating `context.res`.
- **Logic**:
  - Preserves the original sequence:
    - `initializeApp()`.
    - `secretsHealthCheck()` to validate Key Vault.
    - `getSecret('DATABASE_URL')`, `getSecret('HMAC_SECRET_KEY')`, `getSecret('JWT_SECRET')`.
    - `databaseHealthCheck()` to validate database connectivity.
  - Computes `databaseUrlSource` using the same decision tree as the v3 function.
  - Returns a JSON payload that matches the v3 shape and fields.
  - Adds a structured `context.log` call summarizing key health indicators for observability.

### Route and binding changes

- **Original**:
  - Route: default v3 HTTP trigger route (implicitly `/api/funcGetHealth` or similar, depending on host configuration).
  - Binding: `httpTrigger` + `http` output, `authLevel: function`, `methods: ["get"]`.
- **New**:
  - Route: `system/get-health` (accessed as `/api/system/get-health`).
  - Binding: defined via `app.http("GetHealth", { methods: ["GET"], authLevel: "function", route: "system/get-health", handler: systemGetHealthHandler })`.

### Behavioral changes and edge cases

- **Preserved behavior**:
  - Key Vault health and metadata fields.
  - Secret retrieval behavior and boolean `retrieved` flags.
  - Database health check and its output fields (`status`, `timestamp`, `poolStats`, `error`).
  - Logic for deciding the `databaseUrlSource` string.
- **Minor enhancements**:
  - Added `context.log` for easier diagnosis of health check results.
- **Edge cases**:
  - If any of the secrets are missing, the `retrieved` flag is `false` and the value is `"Not available"`, identical to v3 behavior.
  - If database health check returns an error, it is surfaced under `databaseConnection.error` while preserving the rest of the payload.

### Testing considerations

- This function is primarily diagnostic/operational; tests should:
  - Confirm a `200` HTTP status for a healthy environment.
  - Validate the shape of the JSON response (presence of `keyVault`, `databaseUrl`, `hmacKey`, `jwtSecret`, `databaseConnection`).
  - Optionally simulate failure scenarios (e.g. Key Vault or database issues) via mocked services in unit tests, or via environment manipulation in integration tests.

### Known limitations / TODOs

- No explicit rate limiting or authentication customization beyond `authLevel: "function"`.
- Does not redact secret *values* in the response when `retrieved` is `true`; this mirrors v3 behavior but may warrant tightening in future iterations.
- Additional structured logging and telemetry correlation could be added for large-scale production environments.

