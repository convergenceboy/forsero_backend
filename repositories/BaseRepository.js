// BaseRepository.js
// Base class for all repository implementations
// Provides shared utilities and validation methods
// Follows ROE separation of concerns principles

import { executeTenantQuery, executeQuery, executeTransaction } from '../services/serviceDatabase.js';

/**
 * Base repository class providing common functionality for all domain repositories
 * Centralizes database connection utilities and common validation
 */
export class BaseRepository {
  constructor() {
    // Import shared database utilities
    this.executeTenantQuery = executeTenantQuery;
    this.executeQuery = executeQuery;
    this.executeTransaction = executeTransaction;
  }
  
  /**
   * Validate tenant ID parameter
   * @param {number} tenant_id - Tenant ID to validate
   * @throws {Error} If tenant ID is invalid
   */
  validateTenantId(tenant_id) {
    if (!tenant_id || typeof tenant_id !== 'number' || tenant_id <= 0) {
      throw new Error('Valid tenant_id is required');
    }
  }

  /**
   * Validate user ID parameter
   * @param {number} user_id - User ID to validate
   * @throws {Error} If user ID is invalid
   */
  validateUserId(user_id) {
    if (!user_id || typeof user_id !== 'number' || user_id <= 0) {
      throw new Error('Valid user_id is required');
    }
  }

  /**
   * Validate required string parameter
   * @param {string} value - String value to validate
   * @param {string} paramName - Parameter name for error message
   * @throws {Error} If string is invalid
   */
  validateRequiredString(value, paramName) {
    if (!value || typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Valid ${paramName} is required`);
    }
  }

  /**
   * Validate required object parameter
   * @param {Object} value - Object value to validate
   * @param {string} paramName - Parameter name for error message
   * @throws {Error} If object is invalid
   */
  validateRequiredObject(value, paramName) {
    if (!value || typeof value !== 'object' || value === null) {
      throw new Error(`Valid ${paramName} is required`);
    }
  }

  /**
   * Log repository operation for debugging
   * @param {string} operation - Operation name
   * @param {Object} params - Operation parameters
   */
  logOperation(operation, params) {
    console.log(`[${this.constructor.name}] ${operation}:`, params);
  }

  /**
   * Handle repository errors consistently
   * @param {Error} error - Original error
   * @param {string} operation - Operation that failed
   * @param {Object} context - Additional context
   * @throws {Error} Formatted error with context
   */
  handleError(error, operation, context = {}) {
    const errorMessage = `${this.constructor.name}.${operation} failed: ${error.message}`;
    console.error(errorMessage, { context, originalError: error });
    throw new Error(errorMessage);
  }
}


