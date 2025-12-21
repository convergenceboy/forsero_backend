// services/serviceTenant.js
// Tenant resolution and management service
// Infrastructure service that handles tenant resolution from HTTP requests
// Uses TenantRepository for data access while providing caching and request processing
//
// ARCHITECTURE NOTE: This service maintains infrastructure concerns (HTTP processing, 
// caching, dev fallbacks) while delegating data access to TenantRepository.
// This hybrid approach ensures proper separation of concerns while optimizing 
// for Azure Functions multi-tenant request patterns.

import { tenantRepository } from '../repositories/index.js';

// Determine if we're running in Azure (production) or locally (development)
const isProduction = process.env.NODE_ENV === 'production' || process.env.AZURE_FUNCTIONS_ENVIRONMENT;

// Tenant cache to avoid database hits on every request
// Uses per-request caching strategy with TenantRepository for data access
let tenantCache = new Map();
let cacheLastUpdated = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Safely get a header value from either a legacy v3-style req.headers object
 * or a v4 HttpRequest with a HttpHeaders collection.
 *
 * @param {Object} req - HTTP request object
 * @param {string} name - Header name
 * @returns {string|undefined} Header value if present
 */
function getHeader(req, name) {
  if (!req || !req.headers) {
    return undefined;
  }

  const headers = req.headers;

  // v4 HttpRequest.headers: use .get()
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase());
  }

  // v3 style plain object
  return headers[name] || headers[name.toLowerCase()];
}

/**
 * Resolve tenant from HTTP request
 * @param {Object} req - HTTP request object
 * @returns {Object} Tenant configuration object
 */
export async function resolveTenant(req) {
  try {
    // For multi-tenant resolution, prioritize x-tenant-domain header, then fall back to Host header
    // This allows frontend or client library to specify tenant domain while using local development servers
    let host = getHeader(req, 'x-tenant-domain');
    
    // If no x-tenant-domain header, fall back to Host header
    if (!host) {
      host = getHeader(req, 'Host');
      if (!host) {
        throw new Error('No tenant domain or host header found in request');
      }
    }

    // Remove port if present (for local development)
    const domain = host.split(':')[0];
    
    // Try database resolution for all domains
    return await resolveTenantFromDatabase(domain);
    
  } catch (error) {
    // Final fallback for development only
    if (!isProduction) {
      return createDefaultDevelopmentTenant();
    }
    throw error;
  }
}

/**
 * Resolve tenant from database using repository pattern
 * @param {string} domain - Domain to resolve
 * @returns {Object} Tenant configuration object
 */
async function resolveTenantFromDatabase(domain) {
  // Check cache first
  if (tenantCache.has(domain) && isCacheValid()) {
    return tenantCache.get(domain);
  }

  // Use repository to get tenant configuration
  const tenantData = await tenantRepository.getTenantConfigByDomain(domain);
  
  if (!tenantData) {
    throw new Error(`No tenant configuration found for domain: ${domain}`);
  }

  // Normalize to expected format for backward compatibility
  const tenant = {
    id: tenantData.id,
    key: tenantData.tenant_key,
    displayName: tenantData.display_name,
    domain: tenantData.domain,
    status: tenantData.is_active ? 'active' : 'inactive',
    brandConfig: tenantData.theme || {},
    featureConfig: tenantData.features || {},
    matchingConfig: tenantData.matching || {},
    description: tenantData.description
  };

  // Cache the result
  tenantCache.set(domain, tenant);
  cacheLastUpdated = Date.now();

  return tenant;
}

/**
 * Create default tenant for development (never called in production)
 * @returns {Object} Default tenant configuration object
 */
function createDefaultDevelopmentTenant() {
  return {
    id: '00000000-0000-0000-0000-000000000001', // Hardcoded UUID for development
    key: 'socialcompass',
    displayName: 'Social Compass (Development)',
    domain: 'localhost',
    status: 'active',
    brandConfig: {
      theme: {
        primaryColor: '#3B82F6',
        backgroundColor: '#FFFFFF',
        textColor: '#1F2937'
      }
    },
    featureConfig: {
      professionalNetworking: true,
      matching: true
    },
    matchingConfig: {
      radiusKm: 50,
      minSharedInterests: 2
    }
  };
}

/**
 * Get tenant by key using repository pattern
 * @param {string} tenantKey - Tenant key (socialcompass, tribalcompass, tribalnetwork)
 * @returns {Object} Tenant configuration object
 */
export async function getTenantByKey(tenantKey) {
  try {
    // Try to get from repository first
    const tenants = await tenantRepository.getAllTenants();
    const tenant = tenants.find(t => t.tenant_key === tenantKey);

    if (!tenant) {
      // In development, return hardcoded tenant if not found in database
      if (!isProduction && tenantKey === 'socialcompass') {
        return createDefaultDevelopmentTenant();
      }
      throw new Error(`Tenant not found: ${tenantKey}`);
    }

    return tenant;
  } catch (error) {
    throw new Error(`Failed to get tenant by key: ${error.message}`);
  }
}

/**
 * Refresh tenant cache from database using repository
 * @deprecated This function is no longer needed with the new per-request caching approach
 */
async function refreshTenantCache() {
  // This function is kept for backward compatibility but is no longer used
  // The new approach caches individual tenant lookups rather than bulk loading
}

/**
 * Check if cache is still valid
 */
function isCacheValid() {
  return cacheLastUpdated && (Date.now() - cacheLastUpdated) < CACHE_TTL;
}

/**
 * Normalize tenant data from database
 * @deprecated This function is no longer needed as TenantRepository handles normalization
 * @param {Object} row - Database row
 * @returns {Object} Normalized tenant object
 */
function normalizeTenantData(row) {
  // This function is kept for backward compatibility but should not be used
  // TenantRepository now handles proper data normalization
  
  return {
    id: row.id,
    key: row.tenant_key,
    displayName: row.display_name,
    domain: row.domain,
    subdomain: row.subdomain,
    status: row.status,
    subscriptionTier: row.subscription_tier,
    brandConfig: row.brand_config || {},
    featureConfig: row.feature_config || {},
    matchingConfig: row.matching_config || {},
    description: row.description,
    adminEmail: row.admin_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Validate tenant access for user operations
 * @param {Object} tenant - Tenant object
 * @param {string} operation - Operation being performed
 * @returns {boolean} Whether operation is allowed
 */
export function validateTenantAccess(tenant, operation = 'read') {
  if (!tenant || tenant.status !== 'active') {
    return false;
  }

  // Additional validation logic can be added here
  // For example, subscription tier checks for premium features
  
  return true;
}

/**
 * Clear tenant cache (for testing/admin operations)
 */
export function clearTenantCache() {
  tenantCache.clear();
  cacheLastUpdated = null;
}

// =======================================================================
// REFACTORING NOTES (2025-07-27)
// =======================================================================
// This service has been refactored to align with the repository pattern:
//
// ✅ INFRASTRUCTURE CONCERNS (Kept in this service):
// - HTTP request processing and domain extraction
// - Tenant caching for performance optimization  
// - Development fallbacks and environment detection
// - Tenant access validation and authorization
//
// 🔄 DATA ACCESS (Now uses TenantRepository):
// - Database queries delegated to TenantRepository.getTenantConfigByDomain()
// - Removed direct executeQuery() calls
// - Eliminated duplicate data normalization logic
// - Leverages BaseRepository error handling and logging
//
// ❌ DEPRECATED FUNCTIONS:
// - refreshTenantCache() - replaced with per-request caching
// - normalizeTenantData() - TenantRepository handles normalization
//
// This hybrid approach maintains the service's critical infrastructure role
// while ensuring proper separation of concerns and repository pattern compliance.
