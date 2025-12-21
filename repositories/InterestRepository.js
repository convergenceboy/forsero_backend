// InterestRepository.js
// Repository for interest management, taxonomy, and discovery matching
// Handles all user interests and discovery operations
// Follows ROE separation of concerns principles

import { BaseRepository } from './BaseRepository.js';

/**
 * Repository for user interests and discovery matching
 * Manages interest storage, taxonomy, and matching algorithms
 */
export class InterestRepository extends BaseRepository {
  constructor() {
    super();
  }

  // =======================================================================
  // INTEREST MANAGEMENT
  // =======================================================================

  /**
   * Save user interests (DEPRECATED - no-op)
   * Interests are now stored locally on the client device in SQLite.
   * This function is kept for API compatibility but does nothing.
   * @param {number} user_id - User ID
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string[]} interestHashes - Array of interest hashes
   * @returns {Promise<Object>} Save result with count
   */
  async saveUserInterests(user_id, tenant_id, interestHashes) {
    this.validateUserId(user_id);
    this.validateTenantId(tenant_id);
    if (!Array.isArray(interestHashes)) {
      throw new Error('interestHashes must be an array');
    }

    this.logOperation('saveUserInterests', { 
      user_id, tenant_id, count: interestHashes.length,
      note: 'Interests are now stored locally on client device'
    });

    // No-op: interests are stored locally on the client
    return { user_id, tenant_id, count: interestHashes.length };
  }

  /**
   * Get user's interest hashes (DEPRECATED - returns empty array)
   * Interests are now stored locally on the client device in SQLite.
   * This function is kept for API compatibility but always returns empty.
   * @param {number} user_id - User ID
   * @param {number} tenant_id - Tenant ID for isolation
   * @returns {Promise<string[]>} Always returns empty array
   */
  async getUserInterestHashes(user_id, tenant_id) {
    this.validateUserId(user_id);
    this.validateTenantId(tenant_id);

    this.logOperation('getUserInterestHashes', { 
      user_id, tenant_id,
      note: 'Interests are now stored locally on client device'
    });

    // Return empty array - interests are stored locally on the client
    return [];
  }

  /**
   * Find users by shared interest hashes (DEPRECATED - returns empty array)
   * Interests are now stored locally on the client device in SQLite.
   * This function is kept for API compatibility but always returns empty.
   * @param {string[]} interestHashes - Array of interest hashes to match
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number|null} excludeUserId - User ID to exclude from results
   * @returns {Promise<Object[]>} Always returns empty array
   */
  async findUsersByInterestHashes(interestHashes, tenant_id, excludeUserId = null) {
    this.validateTenantId(tenant_id);
    if (!Array.isArray(interestHashes) || interestHashes.length === 0) {
      throw new Error('Valid interestHashes array is required');
    }

    this.logOperation('findUsersByInterestHashes', { 
      tenant_id, count: interestHashes.length, excludeUserId,
      note: 'Interests are now stored locally on client device - matching not available'
    });

    // Return empty array - interests are stored locally on the client
    return [];
  }

  /**
   * Validate interests against tenant taxonomy
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number[]} interestIds - Array of interest IDs to validate
   * @returns {Promise<Object>} Validation result with valid/invalid interests
   */
  async validateInterestsAgainstTaxonomy(tenant_id, interestIds) {
    try {
      this.validateTenantId(tenant_id);
      if (!Array.isArray(interestIds)) {
        throw new Error('interestIds must be an array');
      }

      this.logOperation('validateInterestsAgainstTaxonomy', { 
        tenant_id, count: interestIds.length 
      });

      const result = await this.executeTenantQuery(
        `SELECT id FROM tenant_categories WHERE id = ANY($1)`,
        [interestIds],
        tenant_id
      );
      
      const validInterestIds = result.rows.map(row => row.id);
      const invalidInterests = interestIds.filter(id => !validInterestIds.includes(id));
      
      return {
        valid: invalidInterests.length === 0,
        invalidInterests,
        validInterestIds
      };
    } catch (error) {
      this.handleError(error, 'validateInterestsAgainstTaxonomy', { 
        tenant_id, count: interestIds.length 
      });
      return {
        valid: false,
        invalidInterests: interestIds,
        validInterestIds: []
      };
    }
  }

  // =======================================================================
  // GEOSPATIAL MATCHING
  // =======================================================================

  /**
   * Find nearby users with shared interests using PostGIS (DEPRECATED - returns nearby users without interest matching)
   * Interests are now stored locally on the client device in SQLite.
   * This function now only returns nearby users by location, without interest matching.
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} longitude - User's longitude
   * @param {number} latitude - User's latitude
   * @param {number} excludeUserId - User ID to exclude from results
   * @param {number} radiusMeters - Search radius in meters
   * @param {string[]} interestHashes - Array of interest hashes (ignored - kept for API compatibility)
   * @param {number} maxUsers - Maximum number of users to return (default 50)
   * @returns {Promise<Object[]>} Array of nearby users (without interest matching)
   */
  async findNearbyUsersWithSharedInterests(tenant_id, longitude, latitude, excludeUserId, radiusMeters, interestHashes, maxUsers = 50) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(excludeUserId);
      
      if (typeof longitude !== 'number' || typeof latitude !== 'number') {
        throw new Error('Valid longitude and latitude are required');
      }
      if (typeof radiusMeters !== 'number' || radiusMeters <= 0) {
        throw new Error('Valid radiusMeters is required');
      }
      if (!Array.isArray(interestHashes)) {
        throw new Error('Valid interestHashes array is required');
      }

      this.logOperation('findNearbyUsersWithSharedInterests', { 
        tenant_id, excludeUserId, radiusMeters, interestCount: interestHashes.length, maxUsers,
        note: 'Interests are now stored locally - returning nearby users without interest matching'
      });

      // Return nearby users by location only (interest matching not available)
      const result = await this.executeTenantQuery(
        `SELECT ul.user_id, 
                ST_Distance(
                  ul.location,
                  ST_SetSRID(ST_MakePoint($2, $3), 4326)
                ) AS distance
         FROM user_locations ul
         WHERE ul.tenant_id = $1 
           AND ul.user_id != $4
           AND ST_DWithin(
                 ul.location,
                 ST_SetSRID(ST_MakePoint($2, $3), 4326),
                 $5
               )
         ORDER BY distance ASC
         LIMIT $6`,
        [longitude, latitude, excludeUserId, radiusMeters, maxUsers],
        tenant_id
      );
      
      return result.rows.map(row => ({
        user_id: row.user_id,
        distance: parseFloat(row.distance),
        shared_count: 0, // No interest matching available
        shared_hashes: [] // No interest matching available
      }));
    } catch (error) {
      this.handleError(error, 'findNearbyUsersWithSharedInterests', { 
        tenant_id, excludeUserId, radiusMeters, interestCount: interestHashes.length, maxUsers 
      });
      return [];
    }
  }
}

// Export singleton instance
export const interestRepository = new InterestRepository();


