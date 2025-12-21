// LocationRepository.js
// Repository for spatial data, location tracking, and nearby activity
// Handles all geographic and spatial operations
// Follows ROE separation of concerns principles

import { BaseRepository } from './BaseRepository.js';

/**
 * Repository for spatial and location-based operations
 * Manages user locations, spatial queries, and nearby activity
 */
export class LocationRepository extends BaseRepository {
  constructor() {
    super();
  }

  // =======================================================================
  // LOCATION MANAGEMENT
  // =======================================================================

  /**
   * Update user location using PostGIS
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {number} longitude - Longitude coordinate
   * @param {number} latitude - Latitude coordinate
   * @returns {Promise<Object>} Update result with timestamp
   */
  async updateUserLocation(tenant_id, user_id, longitude, latitude) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);
      
      if (typeof longitude !== 'number' || typeof latitude !== 'number') {
        throw new Error('Valid longitude and latitude coordinates are required');
      }
      
      // Validate coordinate ranges
      if (longitude < -180 || longitude > 180) {
        throw new Error('Longitude must be between -180 and 180');
      }
      if (latitude < -90 || latitude > 90) {
        throw new Error('Latitude must be between -90 and 90');
      }

      this.logOperation('updateUserLocation', { 
        tenant_id, user_id, longitude, latitude 
      });

      // UPSERT operation with PostGIS point creation
      const result = await this.executeTenantQuery(
        `INSERT INTO user_locations (tenant_id, user_id, location, last_updated)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), NOW())
         ON CONFLICT (user_id, tenant_id)
         DO UPDATE SET location = EXCLUDED.location, last_updated = EXCLUDED.last_updated
         RETURNING last_updated`,
        [user_id, longitude, latitude],
        tenant_id
      );
      
      return result.rows[0];
    } catch (error) {
      this.handleError(error, 'updateUserLocation', { 
        tenant_id, user_id, longitude, latitude 
      });
      throw error;
    }
  }

  /**
   * Get user location coordinates
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @returns {Promise<Object|null>} Location data or null if not found
   */
  async getUserLocation(tenant_id, user_id) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);

      this.logOperation('getUserLocation', { tenant_id, user_id });

      const result = await this.executeTenantQuery(
        `SELECT 
           ST_X(location) as longitude,
           ST_Y(location) as latitude,
           last_updated
         FROM user_locations 
         WHERE tenant_id = $1 AND user_id = $2`,
        [user_id],
        tenant_id
      );
      
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      this.handleError(error, 'getUserLocation', { tenant_id, user_id });
      return null;
    }
  }

  // =======================================================================
  // SPATIAL QUERIES & ANALYTICS
  // =======================================================================

  /**
   * Find nearby users within radius (without interest filtering)
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} longitude - Center longitude
   * @param {number} latitude - Center latitude
   * @param {number} excludeUserId - User ID to exclude from results
   * @param {number} radiusMeters - Search radius in meters
   * @param {number} maxUsers - Maximum number of users to return (default 50)
   * @returns {Promise<Object[]>} Array of nearby users with distances
   */
  async findNearbyUsers(tenant_id, longitude, latitude, excludeUserId, radiusMeters, maxUsers = 50) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(excludeUserId);
      
      if (typeof longitude !== 'number' || typeof latitude !== 'number') {
        throw new Error('Valid longitude and latitude are required');
      }
      if (typeof radiusMeters !== 'number' || radiusMeters <= 0) {
        throw new Error('Valid radiusMeters is required');
      }

      this.logOperation('findNearbyUsers', { 
        tenant_id, excludeUserId, radiusMeters, maxUsers 
      });

      const result = await this.executeTenantQuery(
        `SELECT 
            ul.user_id,
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
        distance: parseFloat(row.distance)
      }));
    } catch (error) {
      this.handleError(error, 'findNearbyUsers', { 
        tenant_id, excludeUserId, radiusMeters, maxUsers 
      });
      return [];
    }
  }

  /**
   * Get location statistics for a tenant
   * @param {number} tenant_id - Tenant ID for isolation
   * @returns {Promise<Object>} Location statistics
   */
  async getLocationStatistics(tenant_id) {
    try {
      this.validateTenantId(tenant_id);

      this.logOperation('getLocationStatistics', { tenant_id });

      const result = await this.executeTenantQuery(
        `SELECT 
            COUNT(*) as users_with_location,
            AVG(ST_X(location)) as avg_longitude,
            AVG(ST_Y(location)) as avg_latitude,
            MIN(last_updated) as oldest_update,
            MAX(last_updated) as newest_update
         FROM user_locations
         WHERE tenant_id = $1`,
        [],
        tenant_id
      );
      
      const stats = result.rows[0];
      return {
        users_with_location: parseInt(stats.users_with_location),
        avg_longitude: stats.avg_longitude ? parseFloat(stats.avg_longitude) : null,
        avg_latitude: stats.avg_latitude ? parseFloat(stats.avg_latitude) : null,
        oldest_update: stats.oldest_update,
        newest_update: stats.newest_update
      };
    } catch (error) {
      this.handleError(error, 'getLocationStatistics', { tenant_id });
      return {
        users_with_location: 0,
        avg_longitude: null,
        avg_latitude: null,
        oldest_update: null,
        newest_update: null
      };
    }
  }

  /**
   * Get users within a geographic bounding box
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} minLongitude - Minimum longitude (west bound)
   * @param {number} maxLongitude - Maximum longitude (east bound)
   * @param {number} minLatitude - Minimum latitude (south bound)
   * @param {number} maxLatitude - Maximum latitude (north bound)
   * @param {number|null} excludeUserId - User ID to exclude from results
   * @param {number} maxUsers - Maximum number of users to return (default 100)
   * @returns {Promise<Object[]>} Array of users within bounding box
   */
  async getUsersInBoundingBox(tenant_id, minLongitude, maxLongitude, minLatitude, maxLatitude, excludeUserId = null, maxUsers = 100) {
    try {
      this.validateTenantId(tenant_id);
      
      // Validate bounding box coordinates
      if (typeof minLongitude !== 'number' || typeof maxLongitude !== 'number' ||
          typeof minLatitude !== 'number' || typeof maxLatitude !== 'number') {
        throw new Error('Valid bounding box coordinates are required');
      }
      
      if (minLongitude >= maxLongitude || minLatitude >= maxLatitude) {
        throw new Error('Invalid bounding box: min values must be less than max values');
      }

      this.logOperation('getUsersInBoundingBox', { 
        tenant_id, minLongitude, maxLongitude, minLatitude, maxLatitude, excludeUserId, maxUsers 
      });

      let query = `
        SELECT 
            ul.user_id,
            ST_X(ul.location) as longitude,
            ST_Y(ul.location) as latitude,
            ul.last_updated
        FROM user_locations ul
        WHERE ul.tenant_id = $1
        AND ST_Within(
            ul.location,
            ST_MakeEnvelope($2, $3, $4, $5, 4326)
        )
      `;
      
      let params = [minLongitude, minLatitude, maxLongitude, maxLatitude];
      
      if (excludeUserId) {
        this.validateUserId(excludeUserId);
        query += ` AND ul.user_id != $6`;
        params.push(excludeUserId);
        query += ` ORDER BY ul.last_updated DESC LIMIT $7`;
        params.push(maxUsers);
      } else {
        query += ` ORDER BY ul.last_updated DESC LIMIT $6`;
        params.push(maxUsers);
      }

      const result = await this.executeTenantQuery(query, params, tenant_id);
      
      return result.rows.map(row => ({
        user_id: row.user_id,
        longitude: parseFloat(row.longitude),
        latitude: parseFloat(row.latitude),
        last_updated: row.last_updated
      }));
    } catch (error) {
      this.handleError(error, 'getUsersInBoundingBox', { 
        tenant_id, minLongitude, maxLongitude, minLatitude, maxLatitude, excludeUserId, maxUsers 
      });
      return [];
    }
  }

  /**
   * Calculate distance between two users
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user1_id - First user ID
   * @param {number} user2_id - Second user ID
   * @returns {Promise<number|null>} Distance in meters or null if locations not found
   */
  async getDistanceBetweenUsers(tenant_id, user1_id, user2_id) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user1_id);
      this.validateUserId(user2_id);

      this.logOperation('getDistanceBetweenUsers', { tenant_id, user1_id, user2_id });

      const result = await this.executeTenantQuery(
        `SELECT ST_Distance(u1.location, u2.location) as distance
         FROM user_locations u1, user_locations u2
         WHERE u1.tenant_id = $1 AND u2.tenant_id = $1
         AND u1.user_id = $2 AND u2.user_id = $3`,
        [user1_id, user2_id],
        tenant_id
      );
      
      return result.rows.length > 0 ? parseFloat(result.rows[0].distance) : null;
    } catch (error) {
      this.handleError(error, 'getDistanceBetweenUsers', { tenant_id, user1_id, user2_id });
      return null;
    }
  }

  /**
   * Delete user location data
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteUserLocation(tenant_id, user_id) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);

      this.logOperation('deleteUserLocation', { tenant_id, user_id });

      const result = await this.executeTenantQuery(
        'DELETE FROM user_locations WHERE tenant_id = $1 AND user_id = $2',
        [user_id],
        tenant_id
      );
      
      return { 
        success: true, 
        deleted: result.rowCount > 0,
        user_id: user_id 
      };
    } catch (error) {
      this.handleError(error, 'deleteUserLocation', { tenant_id, user_id });
      return { 
        success: false, 
        deleted: false,
        user_id: user_id,
        error: error.message 
      };
    }
  }

  /**
   * Get anonymized nearby activity data for community engagement
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} latitude - Latitude coordinate
   * @param {number} longitude - Longitude coordinate
   * @param {number} radiusKm - Search radius in kilometers (default 25)
   * @returns {Promise<Object>} Nearby activity metrics
   */
  async getNearbyActivityData(tenant_id, latitude, longitude, radiusKm = 25) {
    try {
      this.validateTenantId(tenant_id);
      
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        throw new Error('Valid latitude and longitude coordinates are required');
      }
      
      // Validate coordinate ranges
      if (longitude < -180 || longitude > 180) {
        throw new Error('Longitude must be between -180 and 180');
      }
      if (latitude < -90 || latitude > 90) {
        throw new Error('Latitude must be between -90 and 90');
      }
      
      if (typeof radiusKm !== 'number' || radiusKm <= 0) {
        throw new Error('Valid radius in kilometers is required');
      }

      this.logOperation('getNearbyActivityData', {
        tenant_id, latitude, longitude, radiusKm
      });

      // Get count of users active in the last 24 hours within radius
      const activeUsersResult = await this.executeTenantQuery(
        `SELECT COUNT(DISTINCT ul.user_id) as active_count
         FROM user_locations ul
         WHERE tenant_id = $1 
         AND ST_DWithin(
           ul.location,
           ST_SetSRID(ST_MakePoint($2, $3), 4326),
           $4 * 1000
         )
         AND ul.last_updated >= NOW() - INTERVAL '24 hours'`,
        [latitude, longitude, radiusKm],
        tenant_id
      );

      // Note: Interest updates are no longer tracked in the database.
      // Interests are now stored locally on the client device in SQLite.
      // newInterests is set to 0 since we can't track interest updates server-side anymore.

      const result = {
        activeToday: parseInt(activeUsersResult.rows[0]?.active_count || 0),
        newInterests: 0, // Interests are stored locally - not tracked server-side
        lastUpdated: new Date().toISOString()
      };

      return result;
    } catch (error) {
      this.handleError(error, 'getNearbyActivityData', {
        tenant_id, latitude, longitude, radiusKm
      });
      throw new Error(`Failed to get nearby activity data: ${error.message}`);
    }
  }
}

// Export singleton instance
export const locationRepository = new LocationRepository();


