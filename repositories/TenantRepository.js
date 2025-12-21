// TenantRepository.js
// Repository for multi-tenant configuration and tenant data
// Handles all tenant management and configuration operations
// Follows ROE separation of concerns principles

import { BaseRepository } from './BaseRepository.js';

/**
 * Repository for tenant management and configuration
 * Manages tenant settings, configuration, and multi-tenant data
 */
export class TenantRepository extends BaseRepository {
  constructor() {
    super();
  }

  // =======================================================================
  // TENANT MANAGEMENT
  // =======================================================================

  /**
   * Get all active tenants (administrative function)
   * @returns {Promise<Object[]>} Array of all active tenants
   */
  async getAllTenants() {
    try {
      this.logOperation('getAllTenants', {});

      const result = await this.executeQuery(
        `SELECT id, tenant_key, domain, display_name, description, config, is_active, created_at
         FROM tenants 
         WHERE is_active = true
         ORDER BY display_name, id`
      );
      
      return result.rows.map(row => ({
        id: row.id,
        tenant_key: row.tenant_key,
        domain: row.domain,
        display_name: row.display_name,
        description: row.description,
        is_active: row.is_active,
        created_at: row.created_at,
        ...(row.config || {}) // merge config JSONB if present
      }));
    } catch (error) {
      this.handleError(error, 'getAllTenants', {});
      return [];
    }
  }

  /**
   * Get tenant by ID
   * @param {number} tenant_id - Tenant ID
   * @returns {Promise<Object|null>} Tenant data or null if not found
   */
  async getTenantById(tenant_id) {
    try {
      this.validateTenantId(tenant_id);

      this.logOperation('getTenantById', { tenant_id });

      const result = await this.executeQuery(
        `SELECT id, tenant_key, domain, display_name, description, config, is_active
         FROM tenants 
         WHERE id = $1`,
        [tenant_id]
      );
      
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      this.handleError(error, 'getTenantById', { tenant_id });
      return null;
    }
  }

  /**
   * Get full tenant configuration by domain
   * @param {string} domain - Tenant domain
   * @returns {Promise<Object|null>} Complete tenant configuration or null
   */
  async getTenantConfigByDomain(domain) {
    try {
      this.validateRequiredString(domain, 'domain');

      this.logOperation('getTenantConfigByDomain', { domain });

      const result = await this.executeQuery(
        `SELECT id, tenant_key, domain, display_name, description, 
                brand_config, feature_config, matching_config, is_active
         FROM tenants 
         WHERE domain = $1 AND is_active = true`,
        [domain]
      );
      
      if (result.rows.length === 0) return null;
      
      const tenant = result.rows[0];
      return {
        id: tenant.id,
        tenant_key: tenant.tenant_key,
        domain: tenant.domain,
        display_name: tenant.display_name,
        description: tenant.description,
        theme: tenant.brand_config || {},
        features: tenant.feature_config || {},
        matching: tenant.matching_config || {},
        is_active: tenant.is_active
      };
    } catch (error) {
      this.handleError(error, 'getTenantConfigByDomain', { domain });
      return null;
    }
  }

  /**
   * Get public tenant configuration (limited fields for unauthenticated access)
   * @param {string} domain - Tenant domain
   * @returns {Promise<Object|null>} Public tenant configuration or null
   */
  async getTenantPublicConfig(domain) {
    try {
      this.validateRequiredString(domain, 'domain');

      this.logOperation('getTenantPublicConfig', { domain });

      const result = await this.executeQuery(
        `SELECT id, tenant_key, domain, display_name, description, brand_config
         FROM tenants 
         WHERE domain = $1 AND is_active = true`,
        [domain]
      );
      
      if (result.rows.length === 0) return null;
      
      const tenant = result.rows[0];
      return {
        id: tenant.id,
        tenant_key: tenant.tenant_key,
        domain: tenant.domain,
        display_name: tenant.display_name,
        description: tenant.description,
        theme: tenant.brand_config || {}
        // Note: feature_config and matching_config not included for security
      };
    } catch (error) {
      this.handleError(error, 'getTenantPublicConfig', { domain });
      return null;
    }
  }

  // =======================================================================
  // TENANT CONFIGURATION OPTIONS
  // =======================================================================

  /**
   * Get tenant age brackets configuration
   * @param {number} tenant_id - Tenant ID for isolation
   * @returns {Promise<Object>} Age brackets configuration
   */
  async getTenantAgeBrackets(tenant_id) {
    try {
      this.validateTenantId(tenant_id);

      this.logOperation('getTenantAgeBrackets', { tenant_id });

      const result = await this.executeTenantQuery(
        'SELECT label, is_default, sort_order FROM tenant_age_brackets WHERE tenant_id = $1 ORDER BY sort_order ASC',
        [],
        tenant_id
      );
      
      const ageBrackets = result.rows.map(row => row.label);
      const defaultAgeBracket = result.rows.find(row => row.is_default)?.label || '';
      
      return { ageBrackets, defaultAgeBracket };
    } catch (error) {
      this.handleError(error, 'getTenantAgeBrackets', { tenant_id });
      return { ageBrackets: [], defaultAgeBracket: '' };
    }
  }

  /**
   * Get tenant maturity levels configuration
   * @param {number} tenant_id - Tenant ID for isolation
   * @returns {Promise<Object>} Maturity levels configuration
   */
  async getTenantMaturityLevels(tenant_id) {
    try {
      this.validateTenantId(tenant_id);

      this.logOperation('getTenantMaturityLevels', { tenant_id });

      const result = await this.executeTenantQuery(
        'SELECT label, is_default, sort_order FROM tenant_maturity_levels WHERE tenant_id = $1 ORDER BY sort_order ASC',
        [],
        tenant_id
      );
      
      const maturityLevels = result.rows.map(row => row.label);
      const defaultMaturityLevel = result.rows.find(row => row.is_default)?.label || '';
      
      return { maturityLevels, defaultMaturityLevel };
    } catch (error) {
      this.handleError(error, 'getTenantMaturityLevels', { tenant_id });
      return { maturityLevels: [], defaultMaturityLevel: '' };
    }
  }

  /**
   * Get combined tenant options (age brackets and maturity levels)
   * @param {number} tenant_id - Tenant ID for isolation
   * @returns {Promise<Object>} Combined tenant options
   */
  async getTenantOptions(tenant_id) {
    try {
      this.validateTenantId(tenant_id);

      this.logOperation('getTenantOptions', { tenant_id });

      // Combine both age brackets and maturity levels in one call
      const [ageBracketsData, maturityLevelsData] = await Promise.all([
        this.getTenantAgeBrackets(tenant_id),
        this.getTenantMaturityLevels(tenant_id)
      ]);
      
      return {
        ...ageBracketsData,
        ...maturityLevelsData
      };
    } catch (error) {
      this.handleError(error, 'getTenantOptions', { tenant_id });
      return {
        ageBrackets: [],
        defaultAgeBracket: '',
        maturityLevels: [],
        defaultMaturityLevel: ''
      };
    }
  }

  // =======================================================================
  // TAXONOMY MANAGEMENT
  // =======================================================================

  /**
   * Get tenant taxonomy data with maturity filtering
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string} maxMaturityRating - Maximum maturity rating filter
   * @returns {Promise<Object[]>} Raw taxonomy data
   */
  async getTenantTaxonomyData(tenant_id, maxMaturityRating) {
    try {
      this.validateTenantId(tenant_id);
      this.validateRequiredString(maxMaturityRating, 'maxMaturityRating');

      this.logOperation('getTenantTaxonomyData', { tenant_id, maxMaturityRating });

      // Complex hierarchical query for taxonomy structure with maturity rating filtering
      const result = await this.executeTenantQuery(
        `SELECT 
            mc.id as category_id, 
            mc.name as category_name,
            tc.id as tenant_category_id,
            tc.display_name as tenant_category_display_name,
            tc.sort_order as category_sort_order,
            ts.id as tenant_subcategory_id,
            ts.name as tenant_subcategory_display_name,
            0 as subcategory_sort_order,
            mi.id as master_interest_id,
            mi.name as master_interest_name,
            ti.id as tenant_interest_id,
            ti.display_name as tenant_interest_display_name,
            ti.sort_order as interest_sort_order,
            mcr.rating_code as category_maturity_rating,
            mir.rating_code as interest_maturity_rating,
            tcr.rating_code as tenant_category_maturity_rating,
            tir.rating_code as tenant_interest_maturity_rating
         FROM tenant_categories tc
         JOIN master_categories mc ON tc.master_category_id = mc.id
         JOIN master_maturity_ratings mcr ON mc.maturity_rating_id = mcr.id
         JOIN master_maturity_ratings tcr ON tc.maturity_rating_id = tcr.id
         LEFT JOIN tenant_subcategories ts ON tc.id = ts.category_id AND ts.tenant_id = $1
         LEFT JOIN tenant_interests ti ON ts.id = ti.subcategory_id AND ti.tenant_id = $1
         LEFT JOIN master_interests mi ON ti.master_interest_id = mi.id
         LEFT JOIN master_maturity_ratings mir ON mi.maturity_rating_id = mir.id
         LEFT JOIN master_maturity_ratings tir ON ti.maturity_rating_id = tir.id
         WHERE tc.tenant_id = $1 AND tc.is_visible = true
         AND tcr.sort_order <= (SELECT sort_order FROM master_maturity_ratings WHERE rating_code = $2)
         AND (ti.id IS NULL OR tir.sort_order <= (SELECT sort_order FROM master_maturity_ratings WHERE rating_code = $2))
         ORDER BY tc.sort_order, mc.name, ts.name, ti.sort_order, ti.display_name`,
        [maxMaturityRating],
        tenant_id
      );
      
      return result.rows;
    } catch (error) {
      this.handleError(error, 'getTenantTaxonomyData', { tenant_id, maxMaturityRating });
      return [];
    }
  }

  /**
   * Build hierarchical taxonomy structure from flat data
   * @param {Object[]} taxonomyRows - Raw taxonomy data from database
   * @returns {Object[]} Hierarchical taxonomy structure
   */
  buildTaxonomyStructure(taxonomyRows) {
    try {
      this.logOperation('buildTaxonomyStructure', { count: taxonomyRows.length });

      // Transform flat database rows into hierarchical structure
      const taxonomyMap = new Map();

      for (const row of taxonomyRows) {
        let category = taxonomyMap.get(row.category_name);
        if (!category) {
          category = {
            category: row.category_name,
            subcategories: []
          };
          taxonomyMap.set(row.category_name, category);
        }

        // Handle subcategories
        if (row.tenant_subcategory_id && row.tenant_subcategory_display_name) {
          let subcategory = category.subcategories.find(sub => sub.subcategory === row.tenant_subcategory_display_name);
          if (!subcategory) {
            subcategory = {
              subcategory: row.tenant_subcategory_display_name,
              hobbiesDetailed: []
            };
            category.subcategories.push(subcategory);
          }

          // Add interests to the subcategory if they exist
          if (row.tenant_interest_id && row.tenant_interest_display_name) {
            subcategory.hobbiesDetailed.push({
              id: row.tenant_interest_id,
              name: row.tenant_interest_display_name,
              category: row.category_name,
              sortOrder: row.interest_sort_order
            });
          }
        }
      }

      // Convert to array format and filter out empty categories
      return Array.from(taxonomyMap.values())
        .filter(cat => cat.subcategories.length > 0)
        .map(cat => ({
          ...cat,
          subcategories: cat.subcategories
            .sort((a, b) => (a.subcategory || '').localeCompare(b.subcategory || ''))
            .map(sub => ({
              ...sub,
              hobbiesDetailed: sub.hobbiesDetailed.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
            }))
        }));
    } catch (error) {
      this.handleError(error, 'buildTaxonomyStructure', { count: taxonomyRows.length });
      return [];
    }
  }

  /**
   * Get tenant taxonomy with hierarchical structure
   * @param {number} tenant_id - Tenant ID for isolation
   * @param {string} maxMaturityRating - Maximum maturity rating filter
   * @returns {Promise<Object[]>} Hierarchical taxonomy structure
   */
  async getTenantTaxonomy(tenant_id, maxMaturityRating) {
    try {
      this.validateTenantId(tenant_id);
      this.validateRequiredString(maxMaturityRating, 'maxMaturityRating');

      this.logOperation('getTenantTaxonomy', { tenant_id, maxMaturityRating });

      // Combined operation: fetch data and build structure with required maturity filtering
      const taxonomyRows = await this.getTenantTaxonomyData(tenant_id, maxMaturityRating);
      return this.buildTaxonomyStructure(taxonomyRows);
    } catch (error) {
      this.handleError(error, 'getTenantTaxonomy', { tenant_id, maxMaturityRating });
      return [];
    }
  }

  /**
   * Get tenant categories for recovery operations
   * @param {number} tenant_id - Tenant ID for isolation
   * @returns {Promise<Object[]>} Categories for recovery
   */
  async getTenantCategoriesForRecovery(tenant_id) {
    try {
      this.validateTenantId(tenant_id);

      this.logOperation('getTenantCategoriesForRecovery', { tenant_id });

      const result = await this.executeTenantQuery(
        `SELECT tc.id, tc.name, mc.name as category_name
         FROM tenant_categories tc
         JOIN master_categories mc ON tc.category_id = mc.id
         WHERE tc.tenant_id = $1
         ORDER BY mc.name, tc.sort_order`,
        [],
        tenant_id
      );
      
      return result.rows;
    } catch (error) {
      this.handleError(error, 'getTenantCategoriesForRecovery', { tenant_id });
      return [];
    }
  }

  // =======================================================================
  // TENANT ANALYTICS
  // =======================================================================

  /**
   * Get tenant statistics
   * @param {number} tenant_id - Tenant ID for isolation
   * @returns {Promise<Object>} Tenant statistics
   */
  async getTenantStatistics(tenant_id) {
    try {
      this.validateTenantId(tenant_id);

      this.logOperation('getTenantStatistics', { tenant_id });

      const [usersResult, categoriesResult, interestsResult] = await Promise.all([
        this.executeTenantQuery(
          'SELECT COUNT(*) as user_count FROM users WHERE tenant_id = $1',
          [],
          tenant_id
        ),
        this.executeTenantQuery(
          'SELECT COUNT(*) as category_count FROM tenant_categories WHERE tenant_id = $1',
          [],
          tenant_id
        ),
        this.executeTenantQuery(
          'SELECT COUNT(*) as interest_count FROM tenant_interests WHERE tenant_id = $1',
          [],
          tenant_id
        )
      ]);
      
      return {
        tenant_id: tenant_id,
        user_count: parseInt(usersResult.rows[0].user_count),
        category_count: parseInt(categoriesResult.rows[0].category_count),
        interest_count: parseInt(interestsResult.rows[0].interest_count)
      };
    } catch (error) {
      this.handleError(error, 'getTenantStatistics', { tenant_id });
      return {
        tenant_id: tenant_id,
        user_count: 0,
        category_count: 0,
        interest_count: 0
      };
    }
  }

  /**
   * Check if tenant is active
   * @param {number} tenant_id - Tenant ID
   * @returns {Promise<boolean>} True if tenant is active
   */
  async isTenantActive(tenant_id) {
    try {
      this.validateTenantId(tenant_id);

      this.logOperation('isTenantActive', { tenant_id });

      const result = await this.executeQuery(
        'SELECT is_active FROM tenants WHERE id = $1',
        [tenant_id]
      );
      
      return result.rows.length > 0 ? result.rows[0].is_active : false;
    } catch (error) {
      this.handleError(error, 'isTenantActive', { tenant_id });
      return false;
    }
  }

  // =======================================================================
  // SYSTEM CONFIGURATION
  // =======================================================================

  /**
   * Get system configuration by key
   * @param {string} configKey - Configuration key to retrieve
   * @returns {Promise<Object|null>} Configuration value or null if not found
   */
  async getSystemConfig(configKey) {
    try {
      this.validateRequiredString(configKey, 'configKey');

      this.logOperation('getSystemConfig', { configKey });

      const result = await this.executeQuery(
        'SELECT config_value FROM system_config WHERE config_key = $1',
        [configKey]
      );
      
      return result.rows.length > 0 ? result.rows[0].config_value : null;
    } catch (error) {
      this.handleError(error, 'getSystemConfig', { configKey });
      return null;
    }
  }

  /**
   * Get default theme configuration from system config
   * @returns {Promise<Object|null>} Default theme configuration or null
   */
  async getDefaultTheme() {
    try {
      this.logOperation('getDefaultTheme', {});
      
      return await this.getSystemConfig('default_theme');
    } catch (error) {
      this.handleError(error, 'getDefaultTheme', {});
      return null;
    }
  }

  /**
   * Update system configuration
   * @param {string} configKey - Configuration key
   * @param {Object} configValue - Configuration value (will be stored as JSONB)
   * @param {string} description - Optional description
   * @returns {Promise<boolean>} Success status
   */
  async updateSystemConfig(configKey, configValue, description = null) {
    try {
      this.validateRequiredString(configKey, 'configKey');
      if (!configValue || typeof configValue !== 'object') {
        throw new Error('configValue must be a valid object');
      }

      this.logOperation('updateSystemConfig', { configKey, description });

      const result = await this.executeQuery(
        `INSERT INTO system_config (config_key, config_value, description) 
         VALUES ($1, $2, $3)
         ON CONFLICT (config_key) DO UPDATE SET
           config_value = EXCLUDED.config_value,
           description = EXCLUDED.description,
           updated_at = NOW()
         RETURNING id`,
        [configKey, JSON.stringify(configValue), description]
      );
      
      return result.rows.length > 0;
    } catch (error) {
      this.handleError(error, 'updateSystemConfig', { configKey, description });
      return false;
    }
  }
}

// Export singleton instance
export const tenantRepository = new TenantRepository();


