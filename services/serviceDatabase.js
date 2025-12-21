// services/serviceDatabase.js
// Database service. All comments and error messages use ASCII only.
// Centralized database connection service with secure secret management
// Provides a singleton connection pool for all Azure Functions

/**
 * DATABASE QUERY METHODS - Quick Reference
 *
 * Choose your method:
 * • executeTenantQuery()        - Standard queries (99% of cases)
 * • executeComplexTenantQuery() - Complex JOINs with multiple tables
 * • executeTransaction()        - Multi-query atomic operations
 *
 * ========================================================================
 * executeTenantQuery() - STANDARD TENANT QUERIES
 * ========================================================================
 *
 * Use for: Regular queries with simple tenant isolation
 * Key rule: Auto-injects tenant_id as $1, always start WHERE with "tenant_id = $1"
 *
 * Pattern:
 * ```javascript
 * await executeTenantQuery(
 *   'SELECT * FROM users WHERE tenant_id = $1 AND username = $2',
 *   [username],  // Your params only (NOT tenant_id)
 *   tenant_id    // Separate argument
 * );
 * ```
 *
 * SQL patterns:
 * • WHERE tenant_id = $1 AND field = $2
 * • UPDATE table SET field = $2 WHERE tenant_id = $1 AND id = $3
 * • DELETE FROM table WHERE tenant_id = $1 AND condition = $2
 *
 * ========================================================================
 * executeComplexTenantQuery() - COMPLEX JOINS
 * ========================================================================
 *
 * Use for: Multi-table JOINs, spatial queries, complex tenant relationships
 * Key rule: Manual tenant_id parameter management (NOT auto-injected)
 *
 * Pattern:
 * ```javascript
 * await executeComplexTenantQuery(
 *   'SELECT * FROM table1 t1 JOIN table2 t2 ON t1.id = t2.id WHERE t1.tenant_id = $1 AND t2.tenant_id = $1',
 *   [tenant_id, other_params],  // Include tenant_id manually
 *   tenant_id                   // Still required for validation
 * );
 * ```
 *
 * ========================================================================
 * executeTransaction() - ATOMIC OPERATIONS
 * ========================================================================
 *
 * Use for: Multiple queries that must succeed/fail together
 * Key rule: Manual parameter management with raw pg.Client
 *
 * Pattern:
 * ```javascript
 * await executeTransaction(async (client) => {
 *   await client.query('DELETE FROM table WHERE user_id = $1 AND tenant_id = $2', [user_id, tenant_id]);
 *   await client.query('INSERT INTO table VALUES ($1, $2, $3)', [user_id, tenant_id, data]);
 * });
 * ```
 *
 * ========================================================================
 * TROUBLESHOOTING PARAMETER ERRORS
 * ========================================================================
 *
 * Error: "bind message supplies X parameters, but prepared statement requires Y"
 *
 * Fix: Count $1, $2, $3 in SQL vs parameters in array
 * Remember: executeTenantQuery() adds tenant_id as $1 automatically
 *
 * ========================================================================
 */

import pg from 'pg'
import { getSecret } from './serviceSecrets.js'

let pool = null

// Initialize database connection pool with secrets
export async function initializeDatabase() {
  if (pool) return pool

  try {
    const connectionString = await getSecret('DATABASE_URL')
    if (!connectionString) {
      throw new Error('Database URL not found in secret storage')
    }

    pool = new pg.Pool({
      connectionString,
      // Connection pool settings
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    })

    // Test the connection
    const client = await pool.connect()
    client.release()

    return pool
  } catch (error) {
    console.error('Failed to initialize database:', error)
    throw error
  }
}

// Get database connection pool
export async function getDatabasePool() {
  if (!pool) {
    await initializeDatabase()
  }
  return pool
}

// Get a database client from the pool
export async function getDatabaseClient() {
  const dbPool = await getDatabasePool()
  return await dbPool.connect()
}

// Execute a query with automatic connection management
export async function executeQuery(query, params = []) {
  const client = await getDatabaseClient()
  try {
    const result = await client.query(query, params)
    return result
  } finally {
    client.release()
  }
}

export async function executeTenantQuery(query, params = [], tenant_id) {
  if (!tenant_id) {
    throw new Error('Tenant ID is required for tenant-aware queries')
  }

  // Inject tenant_id as the first parameter
  const tenantParams = [tenant_id, ...params]

  return await executeQuery(query, tenantParams)
}

export async function executeTransaction(transactionCallback) {
  const client = await getDatabaseClient()
  try {
    await client.query('BEGIN')
    const result = await transactionCallback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function executeComplexTenantQuery(query, params = [], tenant_id) {
  // Validate tenant ID is provided
  if (!tenant_id) {
    throw new Error(
      'Tenant ID is required for tenant-aware queries - tenant isolation is mandatory',
    )
  }

  // Validate parameters are provided
  if (!params || params.length === 0) {
    throw new Error(
      'Complex tenant queries must include parameters - tenant_id must be manually included',
    )
  }

  // Validate that tenant_id appears in the query (basic security check)
  const queryLower = query.toLowerCase()
  if (!queryLower.includes('tenant_id')) {
    throw new Error(
      'Query must include tenant_id filtering for security - tenant isolation required',
    )
  }

  // Validate that tenant_id appears in parameters (ensure it's actually being used)
  if (!params.includes(tenant_id)) {
    throw new Error(
      `Tenant ID ${tenant_id} must be included in parameters array for proper tenant isolation`,
    )
  }

  return await executeQuery(query, params)
}

// Health check for database connectivity
export async function databaseHealthCheck() {
  try {
    const result = await executeQuery('SELECT NOW() as current_time')
    return {
      status: 'healthy',
      timestamp: result.rows[0].current_time,
      poolStats: pool
        ? {
            totalCount: pool.totalCount,
            idleCount: pool.idleCount,
            waitingCount: pool.waitingCount,
          }
        : null,
    }
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    }
  }
}

// Repository Methods - Centralized SQL Queries

// User Management
// Geospatial and Match Operations

// =======================================================================
// END OF DATABASE SERVICE
// =======================================================================
