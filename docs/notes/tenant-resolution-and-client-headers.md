## Tenant Resolution and Client Headers (v4)

### Overview

- **Context**: In v4, HTTP functions use the `@azure/functions` `HttpRequest` type, whose `headers` are exposed via a `HttpHeaders` collection (with a `.get()` method) instead of the plain object used in v3.
- **Impact**: Existing tenant resolution logic that assumed a v3-style `req.headers` object did not correctly read headers in v4, causing `resolveTenant` to fail and functions to respond with `400` errors.

### Backend change: `resolveTenant` header handling

- **File**: `backend-v4/services/serviceTenant.js`
- **Key change**:
  - Introduced a `getHeader(req, name)` helper that:
    - Uses `req.headers.get(name)` when available (v4 `HttpHeaders`).
    - Falls back to property access on `req.headers` for v3-style objects.
  - Updated `resolveTenant(req)` to call:
    - `getHeader(req, 'x-tenant-domain')` first.
    - If missing, `getHeader(req, 'Host')` as a fallback.
- **Behavior**:
  - Still strips the port from the host (for local dev).
  - Still delegates to `resolveTenantFromDatabase(domain)` and falls back to a dev tenant when not in production.

### Client requirement: headers to send

- **Client location**: `client-v4/src/modules/system.ts`
- **Headers required for tenant-aware functions** (`getHealth`, `getAllTenants`, `getTenantOptions`, and any future tenant-aware system/auth functions):
  - `x-tenant-domain`: **Primary** header used by `resolveTenant` for multi-tenant resolution.
  - `x-forsero-tenant-domain`: **Compatibility** header used elsewhere in the system; kept for backward compatibility.
- **Pattern**:
  - For each request, the client now sends:
    - `x-functions-key`
    - `x-tenant-domain`
    - `x-forsero-tenant-domain`

### Guidance for future functions

- When adding new **tenant-aware** v4 functions:
  - Use `resolveTenant(request)` from `serviceTenant.js` to determine the tenant.
  - Ensure client methods send `x-tenant-domain` (and optionally `x-forsero-tenant-domain`) in their headers.
- When writing tests or external tools:
  - Set the tenant domain via the same `x-tenant-domain` header to avoid `400` responses due to unresolved tenants.
