// AuthRepository.js
// Repository for authentication, user management, and passwordless auth
// Handles all user identity and authentication operations
// Follows ROE separation of concerns principles

import jwt from "jsonwebtoken"

import { BaseRepository } from "./BaseRepository.js"
import { getSecret } from "../services/serviceSecrets.js"

/**
 * Repository for user authentication and identity management
 * Manages users, challenges, recovery, and passwordless authentication
 */
export class AuthRepository extends BaseRepository {
  constructor() {
    super()
    // JWT secret management
    this.jwtSecret = null
    this.JWT_EXPIRES_IN = "24h"
  }

  // =======================================================================
  // JWT SECRET MANAGEMENT
  // =======================================================================

  /**
   * Get JWT secret from secure storage with caching
   * @private
   * @returns {Promise<string>} JWT secret
   */
  async getJwtSecret() {
    try {
      if (!this.jwtSecret) {
        this.jwtSecret = await getSecret("JWT_SECRET")
        if (!this.jwtSecret) {
          throw new Error("JWT secret not found in secret storage")
        }
      }
      return this.jwtSecret
    } catch (error) {
      this.handleError(error, "getJwtSecret", {})
      throw new Error("Failed to retrieve JWT secret")
    }
  }

  /**
   * Generate JWT token with unified payload format
   * @param {number} user_id - User ID
   * @param {string} email - User email
   * @param {string} username - Username
   * @param {number} tenant_id - Tenant ID for multi-tenant isolation
   * @returns {Promise<string>} JWT token
   */
  async generateToken(user_id, email, username, tenant_id) {
    try {
      this.validateUserId(user_id)
      this.validateRequiredString(email, "email")
      this.validateRequiredString(username, "username")
      this.validateTenantId(tenant_id)

      this.logOperation("generateToken", { user_id, username, tenant_id })

      const secret = await this.getJwtSecret()

      const payload = {
        user_id: parseInt(user_id),
        username: username,
        tenant_id: tenant_id,
        email: email,
        type: "passwordless",
        iat: Math.floor(Date.now() / 1000),
        authenticatedAt: new Date().toISOString(),
      }

      return jwt.sign(payload, secret, { expiresIn: this.JWT_EXPIRES_IN })
    } catch (error) {
      this.handleError(error, "generateToken", { user_id, username, tenant_id })
      throw new Error("Failed to generate JWT token")
    }
  }

  /**
   * Verify and decode JWT token
   * @param {string} token - JWT token to verify
   * @returns {Promise<Object>} Decoded token payload
   */
  async verifyToken(token) {
    try {
      this.validateRequiredString(token, "token")

      this.logOperation("verifyToken", { tokenLength: token.length })

      const secret = await this.getJwtSecret()
      const decoded = jwt.verify(token, secret)

      return decoded
    } catch (error) {
      // Log the error but don't expose sensitive details
      this.handleError(error, "verifyToken", { tokenLength: token?.length || 0 })

      if (error.name === "TokenExpiredError") {
        throw new Error("Token has expired")
      } else if (error.name === "JsonWebTokenError") {
        throw new Error("Invalid token")
      } else {
        throw new Error("Token verification failed")
      }
    }
  }

  /**
   * Extract and validate authentication from Azure Function request
   * @param {Object} request - Azure Function request object
   * @returns {Promise<Object>} Authentication context with user information
   */
  async extractAuthFromRequest(request) {
    try {
      this.validateRequiredObject(request, "request")
      this.validateRequiredObject(request.headers, "request.headers")

      this.logOperation("extractAuthFromRequest", {
        hasHeaders: !!request.headers,
        userAgent: request.headers["user-agent"]?.substring(0, 50) || "unknown",
      })

      // Check Authorization header: "Bearer <token>"
      const authHeader = request.headers.authorization || request.headers.Authorization

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Missing or invalid Authorization header")
      }

      const token = authHeader.substring(7) // Remove "Bearer " prefix
      if (!token) {
        throw new Error("Empty token in Authorization header")
      }

      const decoded = await this.verifyToken(token)

      // Return auth context with backward compatibility and enhanced fields
      return {
        user_id: decoded.user_id,
        email: decoded.email || null,
        username: decoded.username || null,
        tenant_id: decoded.tenant_id || null,
        type: decoded.type || "unknown",
        token: token,
      }
    } catch (error) {
      this.handleError(error, "extractAuthFromRequest", {
        hasAuthHeader: !!(request?.headers?.authorization || request?.headers?.Authorization),
        headerCount: Object.keys(request?.headers || {}).length,
      })
      throw new Error(`Authentication failed: ${error.message}`)
    }
  }

  /**
   * Authorize user - ensure they can only access their own data
   * @param {number} authUser_id - Authenticated user ID from token
   * @param {number} requestedUser_id - Requested user ID from request
   */
  authorizeUser(authUser_id, requestedUser_id) {
    try {
      this.validateUserId(authUser_id)
      this.validateUserId(requestedUser_id)

      this.logOperation("authorizeUser", { authUser_id, requestedUser_id })

      if (authUser_id !== parseInt(requestedUser_id)) {
        throw new Error("Unauthorized: You can only access your own data")
      }
    } catch (error) {
      this.handleError(error, "authorizeUser", { authUser_id, requestedUser_id })
      throw error // Re-throw to maintain error message
    }
  }

  /**
   * Validate that user owns the resource they're trying to modify
   * @param {number} authUser_id - Authenticated user ID from token
   * @param {number} resourceUser_id - User ID associated with the resource
   */
  validateUserOwnership(authUser_id, resourceUser_id) {
    try {
      this.validateUserId(authUser_id)
      this.validateUserId(resourceUser_id)

      this.logOperation("validateUserOwnership", { authUser_id, resourceUser_id })

      if (authUser_id !== parseInt(resourceUser_id)) {
        throw new Error("Forbidden: You can only modify your own resources")
      }
    } catch (error) {
      this.handleError(error, "validateUserOwnership", { authUser_id, resourceUser_id })
      throw error // Re-throw to maintain error message
    }
  }

  // =======================================================================
  // USER MANAGEMENT
  // =======================================================================

  /**
   * Get user by username for authentication
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string} username - Username to search for
   * @returns {Promise<Object|null>} User object or null if not found
   */
  async getUserByUsername(tenant_id, username) {
    try {
      this.validateTenantId(tenant_id)
      this.validateRequiredString(username, "username")

      this.logOperation("getUserByUsername", { tenant_id, username })

      const result = await this.executeTenantQuery(
        "SELECT id, username, public_key, created_at FROM users WHERE tenant_id = $1 AND username = $2",
        [username.toLowerCase().trim()],
        tenant_id,
      )

      return result.rows.length > 0 ? result.rows[0] : null
    } catch (error) {
      this.handleError(error, "getUserByUsername", { tenant_id, username })
      return null
    }
  }

  /**
   * Get user by ID
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID to search for
   * @returns {Promise<Object|null>} User object or null if not found
   */
  async getUserById(tenant_id, user_id) {
    try {
      this.validateTenantId(tenant_id)
      this.validateUserId(user_id)

      this.logOperation("getUserById", { tenant_id, user_id })

      const result = await this.executeTenantQuery(
        "SELECT id, username FROM users WHERE tenant_id = $1 AND id = $2",
        [user_id],
        tenant_id,
      )

      return result.rows.length > 0 ? result.rows[0] : null
    } catch (error) {
      this.handleError(error, "getUserById", { tenant_id, user_id })
      return null
    }
  }

  /**
   * Get user's public key by user ID (for ephemeral messaging key exchange)
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @returns {Promise<string|null>} Public key or null if not found
   */
  async getUserPublicKey(tenant_id, user_id) {
    try {
      this.validateTenantId(tenant_id)
      this.validateUserId(user_id)

      this.logOperation("getUserPublicKey", { tenant_id, user_id })

      const result = await this.executeTenantQuery(
        "SELECT public_key FROM users WHERE tenant_id = $1 AND id = $2",
        [user_id],
        tenant_id,
      )

      return result.rows.length > 0 ? result.rows[0].public_key : null
    } catch (error) {
      this.handleError(error, "getUserPublicKey", { tenant_id, user_id })
      return null
    }
  }

  /**
   * Create a new passwordless user
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string} username - Username for the new user
   * @param {string} publicKey - User's public key
   * @param {number} taxonomyVersion - Current taxonomy version (default 1)
   * @returns {Promise<Object>} Created user object
   */
  async createPasswordlessUser(tenant_id, username, publicKey, taxonomyVersion = 1) {
    try {
      this.validateTenantId(tenant_id)
      this.validateRequiredString(username, "username")
      this.validateRequiredString(publicKey, "publicKey")

      this.logOperation("createPasswordlessUser", {
        tenant_id,
        username,
        taxonomyVersion,
      })

      const result = await this.executeTenantQuery(
        `INSERT INTO users (tenant_id, username, public_key, taxonomy_version)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, created_at`,
        [username.toLowerCase().trim(), publicKey, taxonomyVersion],
        tenant_id,
      )

      return result.rows[0]
    } catch (error) {
      this.handleError(error, "createPasswordlessUser", {
        tenant_id,
        username,
        taxonomyVersion,
      })
      throw error
    }
  }

  // =======================================================================
  // USERNAME MANAGEMENT
  // =======================================================================

  /**
   * Check if username is available
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string} username - Username to check
   * @returns {Promise<boolean>} True if available, false if taken
   */
  async checkUsernameAvailability(tenant_id, username) {
    try {
      this.validateTenantId(tenant_id)
      this.validateRequiredString(username, "username")

      this.logOperation("checkUsernameAvailability", { tenant_id, username })

      const result = await this.executeTenantQuery(
        "SELECT username FROM users WHERE tenant_id = $1 AND username ILIKE $2",
        [username.trim()],
        tenant_id,
      )

      // Return true if username is available (no existing users found)
      return result.rows.length === 0
    } catch (error) {
      this.handleError(error, "checkUsernameAvailability", { tenant_id, username })
      return false
    }
  }

  /**
   * Check if username is available (alias for consistency)
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string} username - Username to check
   * @returns {Promise<boolean>} True if available, false if taken
   */
  async isUsernameAvailable(tenant_id, username) {
    return await this.checkUsernameAvailability(tenant_id, username)
  }

  /**
   * Check multiple usernames for availability
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string[]} usernames - Array of usernames to check
   * @returns {Promise<string[]>} Array of available usernames
   */
  async checkMultipleUsernames(tenant_id, usernames) {
    try {
      this.validateTenantId(tenant_id)
      if (!Array.isArray(usernames) || usernames.length === 0) {
        throw new Error("Valid usernames array is required")
      }

      this.logOperation("checkMultipleUsernames", {
        tenant_id,
        count: usernames.length,
      })

      // Batch check multiple usernames for availability
      const placeholders = usernames.map((_, index) => `$${index + 2}`).join(",")
      const result = await this.executeTenantQuery(
        `SELECT LOWER(username) as username FROM users 
         WHERE tenant_id = $1 AND username ILIKE ANY(ARRAY[${placeholders}])`,
        [...usernames.map((u) => u.trim())],
        tenant_id,
      )

      const takenUsernames = new Set(result.rows.map((row) => row.username))
      return usernames.filter((username) => !takenUsernames.has(username.toLowerCase()))
    } catch (error) {
      this.handleError(error, "checkMultipleUsernames", {
        tenant_id,
        count: usernames.length,
      })
      return []
    }
  }

  /**
   * Generate username suggestions based on a base username
   * @param {string} baseUsername - Base username to build suggestions from
   * @returns {string[]} Array of username suggestions
   */
  generateUsernameSuggestions(baseUsername) {
    try {
      this.validateRequiredString(baseUsername, "baseUsername")

      const suggestions = []

      // Add numbers
      for (let i = 1; i <= 99; i++) {
        suggestions.push(`${baseUsername}${i}`)
      }

      // Add common suffixes
      const suffixes = ["_", "123", "2025", "x", "user", "app"]
      for (const suffix of suffixes) {
        suggestions.push(`${baseUsername}${suffix}`)
      }

      // Add prefixes
      const prefixes = ["the", "user", "cool", "real"]
      for (const prefix of prefixes) {
        suggestions.push(`${prefix}${baseUsername}`)
      }

      return suggestions
    } catch (error) {
      this.handleError(error, "generateUsernameSuggestions", { baseUsername })
      return []
    }
  }

  // =======================================================================
  // AUTHENTICATION CHALLENGES
  // =======================================================================

  /**
   * Create an authentication challenge
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID for the challenge
   * @param {string} challenge - Challenge string
   * @param {Date} expiresAt - Challenge expiration time
   * @param {Date} clientTimestamp - Client timestamp
   * @returns {Promise<number>} Challenge ID
   */
  async createAuthChallenge(tenant_id, user_id, challenge, expiresAt, clientTimestamp) {
    try {
      this.validateTenantId(tenant_id)
      this.validateUserId(user_id)
      this.validateRequiredString(challenge, "challenge")

      this.logOperation("createAuthChallenge", {
        tenant_id,
        user_id,
        expiresAt,
        clientTimestamp,
      })

      const result = await this.executeTenantQuery(
        `INSERT INTO auth_challenges (tenant_id, user_id, challenge, expires_at, client_timestamp)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [user_id, challenge, expiresAt, clientTimestamp],
        tenant_id,
      )

      return result.rows[0].id
    } catch (error) {
      this.handleError(error, "createAuthChallenge", {
        tenant_id,
        user_id,
        expiresAt,
      })
      throw error
    }
  }

  /**
   * Count recent challenges for rate limiting
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {Date} windowStart - Start of time window
   * @returns {Promise<Object>} Challenge count result
   */
  async countRecentChallenges(tenant_id, user_id, windowStart) {
    try {
      this.validateTenantId(tenant_id)
      this.validateUserId(user_id)

      this.logOperation("countRecentChallenges", {
        tenant_id,
        user_id,
        windowStart,
      })

      return await this.executeTenantQuery(
        `SELECT COUNT(*) as attempt_count
         FROM auth_challenges
         WHERE tenant_id = $1 AND user_id = $2 AND created_at > $3`,
        [user_id, windowStart],
        tenant_id,
      )
    } catch (error) {
      this.handleError(error, "countRecentChallenges", {
        tenant_id,
        user_id,
        windowStart,
      })
      return { rows: [{ attempt_count: 0 }] }
    }
  }

  /**
   * Get challenge with associated user data
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} challengeId - Challenge ID
   * @returns {Promise<Object|null>} Challenge and user data or null
   */
  async getChallengeWithUser(tenant_id, challengeId) {
    try {
      this.validateTenantId(tenant_id)
      if (!challengeId || typeof challengeId !== "number") {
        throw new Error("Valid challengeId is required")
      }

      this.logOperation("getChallengeWithUser", { tenant_id, challengeId })

      const result = await this.executeTenantQuery(
        `SELECT 
            c.id, c.challenge, c.expires_at, c.used_at,
            u.id as user_id, u.username, u.public_key
         FROM auth_challenges c
         JOIN users u ON c.user_id = u.id
         WHERE c.tenant_id = $1 AND c.id = $2`,
        [challengeId],
        tenant_id,
      )

      return result.rows.length > 0 ? result.rows[0] : null
    } catch (error) {
      this.handleError(error, "getChallengeWithUser", { tenant_id, challengeId })
      return null
    }
  }

  /**
   * Mark challenge as used
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} challengeId - Challenge ID to mark as used
   * @returns {Promise<Object>} Success result
   */
  async markChallengeAsUsed(tenant_id, challengeId) {
    try {
      this.validateTenantId(tenant_id)
      if (!challengeId || typeof challengeId !== "number") {
        throw new Error("Valid challengeId is required")
      }

      this.logOperation("markChallengeAsUsed", { tenant_id, challengeId })

      await this.executeTenantQuery(
        "UPDATE auth_challenges SET used_at = NOW() WHERE tenant_id = $1 AND id = $2",
        [challengeId],
        tenant_id,
      )

      return { success: true }
    } catch (error) {
      this.handleError(error, "markChallengeAsUsed", { tenant_id, challengeId })
      return { success: false, error: error.message }
    }
  }

  /**
   * Check challenge rate limit
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {number} windowMinutes - Time window in minutes (default 15)
   * @param {number} maxAttempts - Maximum attempts allowed (default 5)
   * @returns {Promise<Object>} Rate limit result
   */
  async checkChallengeRateLimit(tenant_id, user_id, windowMinutes = 15, maxAttempts = 5) {
    try {
      this.validateTenantId(tenant_id)
      this.validateUserId(user_id)

      const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000)

      this.logOperation("checkChallengeRateLimit", {
        tenant_id,
        user_id,
        windowMinutes,
        maxAttempts,
      })

      const result = await this.executeTenantQuery(
        `SELECT COUNT(*) as attempt_count
         FROM auth_challenges
         WHERE tenant_id = $1 
         AND user_id = $2 
         AND created_at > $3`,
        [user_id, windowStart],
        tenant_id,
      )

      const attempts = parseInt(result.rows[0].attempt_count)

      if (attempts >= maxAttempts) {
        const retryAfter = Math.ceil(
          (windowStart.getTime() + windowMinutes * 60 * 1000 - Date.now()) / 1000,
        )
        return {
          allowed: false,
          attempts,
          retryAfter,
        }
      }

      return {
        allowed: true,
        attempts,
      }
    } catch (error) {
      this.handleError(error, "checkChallengeRateLimit", {
        tenant_id,
        user_id,
        windowMinutes,
        maxAttempts,
      })
      // On error, be conservative and allow the challenge
      return { allowed: true, attempts: 0 }
    }
  }

  // =======================================================================
  // RECOVERY & MIGRATION
  // =======================================================================

  /**
   * Get user for migration (recovery process)
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string} username - Username to get migration data for
   * @returns {Promise<Object|null>} User migration data or null
   */
  async getUserForMigration(tenant_id, username) {
    try {
      this.validateTenantId(tenant_id)
      this.validateRequiredString(username, "username")

      this.logOperation("getUserForMigration", { tenant_id, username })

      const result = await this.executeTenantQuery(
        `SELECT id, username, public_key, taxonomy_version
         FROM users 
         WHERE tenant_id = $1 AND username = $2`,
        [username.toLowerCase().trim()],
        tenant_id,
      )

      return result.rows.length > 0 ? result.rows[0] : null
    } catch (error) {
      this.handleError(error, "getUserForMigration", { tenant_id, username })
      return null
    }
  }

  /**
   * Get user for recovery hints
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string} username - Username to get recovery hints for
   * @returns {Promise<Object|null>} User recovery data or null
   */
  async getUserForRecoveryHints(tenant_id, username) {
    try {
      this.validateTenantId(tenant_id)
      this.validateRequiredString(username, "username")

      this.logOperation("getUserForRecoveryHints", { tenant_id, username })

      const result = await this.executeTenantQuery(
        `SELECT id, username, created_at 
         FROM users 
         WHERE tenant_id = $1 AND username = $2`,
        [username.toLowerCase().trim()],
        tenant_id,
      )

      return result.rows.length > 0 ? result.rows[0] : null
    } catch (error) {
      this.handleError(error, "getUserForRecoveryHints", { tenant_id, username })
      return null
    }
  }

  /**
   * Update user's last login timestamp
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @returns {Promise<Object>} Update result
   */
  async updateLastLogin(tenant_id, user_id) {
    try {
      this.validateTenantId(tenant_id)
      this.validateUserId(user_id)

      this.logOperation("updateLastLogin", { tenant_id, user_id })

      await this.executeTenantQuery(
        "UPDATE users SET last_login = NOW() WHERE tenant_id = $1 AND id = $2",
        [user_id],
        tenant_id,
      )

      return { success: true, user_id: user_id, last_login: new Date() }
    } catch (error) {
      this.handleError(error, "updateLastLogin", { tenant_id, user_id })
      // Don't throw - last_login update failure shouldn't break authentication
      return { success: false, error: error.message }
    }
  }

  /**
   * Update user recovery data (new public key)
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {string} newPublicKey - New public key
   * @returns {Promise<Object>} Update result
   */
  async updateUserRecoveryData(tenant_id, user_id, newPublicKey) {
    try {
      this.validateTenantId(tenant_id)
      this.validateUserId(user_id)
      this.validateRequiredString(newPublicKey, "newPublicKey")

      this.logOperation("updateUserRecoveryData", { tenant_id, user_id })

      return await this.executeTransaction(async (client) => {
        // Update user key and taxonomy version
        await client.query(
          `UPDATE users 
           SET 
               public_key = $1,
               taxonomy_version = (SELECT MAX(version) FROM taxonomy_versions WHERE tenant_id = $2),
               updated_at = NOW()
           WHERE id = $3 AND tenant_id = $2`,
          [newPublicKey, tenant_id, user_id],
        )

        // Invalidate existing challenges
        await client.query(
          `UPDATE auth_challenges 
           SET expires_at = NOW() 
           WHERE user_id = $1 AND tenant_id = $2 AND expires_at > NOW()`,
          [user_id, tenant_id],
        )

        return { success: true, user_id: user_id, updated_at: new Date() }
      })
    } catch (error) {
      this.handleError(error, "updateUserRecoveryData", { tenant_id, user_id })
      return { success: false, error: error.message }
    }
  }

  /**
   * Check migration rate limit
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {string} deviceFingerprint - Device fingerprint
   * @param {number} windowHours - Time window in hours (default 24)
   * @param {number} maxMigrations - Maximum migrations allowed (default 2)
   * @returns {Promise<Object>} Rate limit result
   */
  async checkMigrationRateLimit(
    tenant_id,
    user_id,
    deviceFingerprint,
    windowHours = 24,
    maxMigrations = 2,
  ) {
    try {
      this.validateTenantId(tenant_id)
      this.validateUserId(user_id)
      this.validateRequiredString(deviceFingerprint, "deviceFingerprint")

      const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)

      this.logOperation("checkMigrationRateLimit", {
        tenant_id,
        user_id,
        windowHours,
        maxMigrations,
      })

      const result = await this.executeTenantQuery(
        `SELECT COUNT(*) as migration_count
         FROM security_events
         WHERE tenant_id = $1
         AND event_data->>'user_id' = $2 
         AND event_data->>'deviceFingerprint' = $3 
         AND event_type = $4
         AND created_at > $5`,
        [user_id.toString(), deviceFingerprint, "RECOVERY_DATA_MIGRATED", windowStart],
        tenant_id,
      )

      const migrations = parseInt(result.rows[0].migration_count)

      if (migrations >= maxMigrations) {
        const retryAfter = Math.ceil(
          (windowStart.getTime() + windowHours * 60 * 60 * 1000 - Date.now()) / 1000,
        )
        return {
          allowed: false,
          migrations,
          retryAfter,
        }
      }

      return {
        allowed: true,
        migrations,
      }
    } catch (error) {
      this.handleError(error, "checkMigrationRateLimit", {
        tenant_id,
        user_id,
        windowHours,
        maxMigrations,
      })
      // On error, be conservative and allow the migration
      return { allowed: true, migrations: 0 }
    }
  }

  /**
   * Log migration attempt for auditing
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {Object} migrationData - Migration attempt data
   * @returns {Promise<void>}
   */
  async logMigrationAttempt(tenant_id, user_id, migrationData) {
    try {
      this.validateTenantId(tenant_id)
      this.validateUserId(user_id)

      this.logOperation("logMigrationAttempt", { tenant_id, user_id })

      await this.executeTenantQuery(
        `INSERT INTO recovery_attempts (tenant_id, user_id, attempt_type, attempt_data, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [user_id, "MIGRATION", JSON.stringify(migrationData)],
        tenant_id,
      )
    } catch (error) {
      // Don't throw on logging errors, just log them
      console.error("Failed to log migration attempt:", error)
    }
  }

  /**
   * Check recovery attempt rate limit
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string} username - Username attempting recovery
   * @param {string} deviceFingerprint - Device fingerprint
   * @param {number} windowHours - Time window in hours (default 1)
   * @param {number} maxAttempts - Maximum attempts allowed (default 5)
   * @returns {Promise<Object>} Rate limit result
   */
  async checkRecoveryAttemptRateLimit(
    tenant_id,
    username,
    deviceFingerprint,
    windowHours = 1,
    maxAttempts = 5,
  ) {
    try {
      this.validateTenantId(tenant_id)
      this.validateRequiredString(username, "username")
      this.validateRequiredString(deviceFingerprint, "deviceFingerprint")

      const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)

      this.logOperation("checkRecoveryAttemptRateLimit", {
        tenant_id,
        username,
        windowHours,
        maxAttempts,
      })

      const result = await this.executeTenantQuery(
        `SELECT COUNT(*) as attempt_count
         FROM security_events
         WHERE tenant_id = $1
         AND event_data->>'username' = $2 
         AND event_data->>'deviceFingerprint' = $3 
         AND event_type = $4
         AND created_at > $5`,
        [username, deviceFingerprint, "RECOVERY_ATTEMPT", windowStart],
        tenant_id,
      )

      const attempts = parseInt(result.rows[0].attempt_count)

      if (attempts >= maxAttempts) {
        const retryAfter = Math.ceil(
          (windowStart.getTime() + windowHours * 60 * 60 * 1000 - Date.now()) / 1000,
        )
        return {
          allowed: false,
          attempts,
          retryAfter,
        }
      }

      return {
        allowed: true,
        attempts,
      }
    } catch (error) {
      this.handleError(error, "checkRecoveryAttemptRateLimit", {
        tenant_id,
        username,
        windowHours,
        maxAttempts,
      })
      // On error, be conservative and allow the recovery attempt
      return { allowed: true, attempts: 0 }
    }
  }
}

// Export singleton instance
export const authRepository = new AuthRepository()
