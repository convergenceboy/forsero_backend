// WidgetRepository.js
// Repository for widget management and user dashboard customization
// Handles all widget-related database operations
// Follows ROE separation of concerns principles

import { BaseRepository } from './BaseRepository.js';

/**
 * Repository for widget management and user dashboard
 * Manages user widget configurations and available widgets
 */
export class WidgetRepository extends BaseRepository {
  constructor() {
    super();
  }

  // =======================================================================
  // USER WIDGET MANAGEMENT
  // =======================================================================

  /**
   * Get user's installed widgets
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @returns {Promise<Object[]>} Array of user widgets with configuration
   */
  async getUserWidgets(tenant_id, user_id) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);

      this.logOperation('getUserWidgets', { tenant_id, user_id });

      const result = await this.executeTenantQuery(
        `SELECT widget_key, position, config
         FROM user_widgets
         WHERE tenant_id = $1 AND user_id = $2
         ORDER BY position ASC, id ASC`,
        [user_id],
        tenant_id
      );
      
      return result.rows;
    } catch (error) {
      this.handleError(error, 'getUserWidgets', { tenant_id, user_id });
      return [];
    }
  }

  /**
   * Add a widget to user's dashboard
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {string} widgetKey - Widget identifier key
   * @param {number} position - Position on dashboard (default 0)
   * @param {Object|null} config - Widget configuration object
   * @returns {Promise<Object>} Created widget entry
   */
  async addUserWidget(tenant_id, user_id, widgetKey, position = 0, config = null) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);
      this.validateRequiredString(widgetKey, 'widgetKey');
      
      if (typeof position !== 'number' || position < 0) {
        throw new Error('Valid position (>= 0) is required');
      }

      this.logOperation('addUserWidget', { 
        tenant_id, user_id, widgetKey, position 
      });

      const result = await this.executeTenantQuery(
        `INSERT INTO user_widgets (tenant_id, user_id, widget_key, position, config)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [user_id, widgetKey, position, config],
        tenant_id
      );
      
      return result.rows[0];
    } catch (error) {
      this.handleError(error, 'addUserWidget', { 
        tenant_id, user_id, widgetKey, position 
      });
      throw error;
    }
  }

  /**
   * Remove a widget from user's dashboard
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {string} widgetKey - Widget identifier key to remove
   * @returns {Promise<boolean>} True if widget was removed, false if not found
   */
  async removeUserWidget(tenant_id, user_id, widgetKey) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);
      this.validateRequiredString(widgetKey, 'widgetKey');

      this.logOperation('removeUserWidget', { tenant_id, user_id, widgetKey });

      const result = await this.executeTenantQuery(
        `DELETE FROM user_widgets 
         WHERE tenant_id = $1 AND user_id = $2 AND widget_key = $3
         RETURNING widget_key`,
        [user_id, widgetKey],
        tenant_id
      );
      
      return result.rows.length > 0;
    } catch (error) {
      this.handleError(error, 'removeUserWidget', { tenant_id, user_id, widgetKey });
      return false;
    }
  }

  /**
   * Reorder user's widgets by updating positions
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {string[]} widgetKeysInOrder - Array of widget keys in desired order
   * @returns {Promise<Object>} Reorder result with count
   */
  async reorderUserWidgets(tenant_id, user_id, widgetKeysInOrder) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);
      
      if (!Array.isArray(widgetKeysInOrder)) {
        throw new Error('widgetKeysInOrder must be an array');
      }

      this.logOperation('reorderUserWidgets', { 
        tenant_id, user_id, count: widgetKeysInOrder.length 
      });

      return await this.executeTransaction(async (client) => {
        for (let i = 0; i < widgetKeysInOrder.length; i++) {
          await client.query(
            `UPDATE user_widgets SET position = $1 
             WHERE user_id = $2 AND widget_key = $3 AND tenant_id = $4`,
            [i, user_id, widgetKeysInOrder[i], tenant_id]
          );
        }
        return { reordered: widgetKeysInOrder.length };
      });
    } catch (error) {
      this.handleError(error, 'reorderUserWidgets', { 
        tenant_id, user_id, count: widgetKeysInOrder.length 
      });
      throw error;
    }
  }

  // =======================================================================
  // WIDGET CATALOG MANAGEMENT
  // =======================================================================

  /**
   * Get available widgets for user (not yet installed)
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @returns {Promise<Object[]>} Array of available widgets
   */
  async getAvailableWidgetsForUser(tenant_id, user_id) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);

      this.logOperation('getAvailableWidgetsForUser', { tenant_id, user_id });

      // Get installed widget keys for user
      const userResult = await this.executeTenantQuery(
        `SELECT widget_key FROM user_widgets WHERE tenant_id = $1 AND user_id = $2`,
        [user_id],
        tenant_id
      );
      const installedKeys = userResult.rows.map(row => row.widget_key);

      // Get all available widgets from tenant_widgets with widget_key from master_widgets
      const allResult = await this.executeTenantQuery(
        `SELECT tw.*, mw.widget_key 
         FROM tenant_widgets tw
         JOIN master_widgets mw ON tw.master_widget_id = mw.id
         WHERE tw.tenant_id = $1 AND tw.is_enabled = true`,
        [],
        tenant_id
      );
      
      // Filter out installed widgets
      const availableWidgets = allResult.rows.filter(w => !installedKeys.includes(w.widget_key));
      return availableWidgets;
    } catch (error) {
      this.handleError(error, 'getAvailableWidgetsForUser', { tenant_id, user_id });
      return [];
    }
  }

  /**
   * Get all available widgets in catalog (including installed)
   * @param {number} tenant_id - Tenant ID for isolation
   * @returns {Promise<Object[]>} Array of all widgets
   */
  async getAllWidgets(tenant_id) {
    try {
      this.validateTenantId(tenant_id);

      this.logOperation('getAllWidgets', { tenant_id });

      const result = await this.executeTenantQuery(
        `SELECT * FROM tenant_widgets 
         WHERE tenant_id = $1
         ORDER BY display_name ASC`,
        [],
        tenant_id
      );
      
      return result.rows;
    } catch (error) {
      this.handleError(error, 'getAllWidgets', { tenant_id });
      return [];
    }
  }

  // =======================================================================
  // WIDGET ANALYTICS & INSIGHTS
  // =======================================================================

  /**
   * Get widget usage statistics for a tenant
   * @param {number} tenant_id - Tenant ID for isolation
   * @returns {Promise<Object[]>} Array of widget usage stats
   */
  async getWidgetUsageStats(tenant_id) {
    try {
      this.validateTenantId(tenant_id);

      this.logOperation('getWidgetUsageStats', { tenant_id });

      const result = await this.executeTenantQuery(
        `SELECT 
            widget_key,
            COUNT(*) as usage_count,
            AVG(position) as avg_position,
            MIN(position) as min_position,
            MAX(position) as max_position
         FROM user_widgets
         WHERE tenant_id = $1
         GROUP BY widget_key
         ORDER BY usage_count DESC`,
        [],
        tenant_id
      );
      
      return result.rows.map(row => ({
        widget_key: row.widget_key,
        usage_count: parseInt(row.usage_count),
        avg_position: parseFloat(row.avg_position),
        min_position: parseInt(row.min_position),
        max_position: parseInt(row.max_position)
      }));
    } catch (error) {
      this.handleError(error, 'getWidgetUsageStats', { tenant_id });
      return [];
    }
  }

  /**
   * Get user's widget configuration summary
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @returns {Promise<Object>} Widget configuration summary
   */
  async getUserWidgetSummary(tenant_id, user_id) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);

      this.logOperation('getUserWidgetSummary', { tenant_id, user_id });

      const result = await this.executeTenantQuery(
        `SELECT 
            COUNT(*) as total_widgets,
            COUNT(CASE WHEN config IS NOT NULL THEN 1 END) as configured_widgets,
            AVG(position) as avg_position,
            MIN(position) as min_position,
            MAX(position) as max_position
         FROM user_widgets
         WHERE tenant_id = $1 AND user_id = $2`,
        [user_id],
        tenant_id
      );
      
      const stats = result.rows[0];
      return {
        user_id: user_id,
        total_widgets: parseInt(stats.total_widgets),
        configured_widgets: parseInt(stats.configured_widgets),
        avg_position: stats.avg_position ? parseFloat(stats.avg_position) : null,
        min_position: stats.min_position !== null ? parseInt(stats.min_position) : null,
        max_position: stats.max_position !== null ? parseInt(stats.max_position) : null
      };
    } catch (error) {
      this.handleError(error, 'getUserWidgetSummary', { tenant_id, user_id });
      return {
        user_id: user_id,
        total_widgets: 0,
        configured_widgets: 0,
        avg_position: null,
        min_position: null,
        max_position: null
      };
    }
  }

  /**
   * Check if user has a specific widget installed
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {string} widgetKey - Widget identifier key
   * @returns {Promise<boolean>} True if widget is installed
   */
  async hasWidget(tenant_id, user_id, widgetKey) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);
      this.validateRequiredString(widgetKey, 'widgetKey');

      this.logOperation('hasWidget', { tenant_id, user_id, widgetKey });

      const result = await this.executeTenantQuery(
        `SELECT 1 FROM user_widgets 
         WHERE tenant_id = $1 AND user_id = $2 AND widget_key = $3`,
        [user_id, widgetKey],
        tenant_id
      );
      
      return result.rows.length > 0;
    } catch (error) {
      this.handleError(error, 'hasWidget', { tenant_id, user_id, widgetKey });
      return false;
    }
  }

  /**
   * Update widget configuration
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {number} user_id - User ID
   * @param {string} widgetKey - Widget identifier key
   * @param {Object} config - New widget configuration
   * @returns {Promise<Object>} Update result
   */
  async updateWidgetConfig(tenant_id, user_id, widgetKey, config) {
    try {
      this.validateTenantId(tenant_id);
      this.validateUserId(user_id);
      this.validateRequiredString(widgetKey, 'widgetKey');

      this.logOperation('updateWidgetConfig', { tenant_id, user_id, widgetKey });

      const result = await this.executeTenantQuery(
        `UPDATE user_widgets 
         SET config = $4, updated_at = NOW()
         WHERE tenant_id = $1 AND user_id = $2 AND widget_key = $3
         RETURNING widget_key`,
        [user_id, widgetKey, config],
        tenant_id
      );
      
      return {
        success: result.rows.length > 0,
        widget_key: widgetKey,
        updated: result.rows.length > 0
      };
    } catch (error) {
      this.handleError(error, 'updateWidgetConfig', { tenant_id, user_id, widgetKey });
      return {
        success: false,
        widget_key: widgetKey,
        updated: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
export const widgetRepository = new WidgetRepository();


