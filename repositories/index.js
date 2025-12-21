// index.js
// Central export file for all repository instances
// Provides easy access to all repositories from a single import
// Follows ROE separation of concerns principles

// Import all repository instances
import { authRepository } from './AuthRepository.js';
import { interestRepository } from './InterestRepository.js';
import { locationRepository } from './LocationRepository.js';
import { tenantRepository } from './TenantRepository.js';
import { widgetRepository } from './WidgetRepository.js';

// Re-export for direct access
export { authRepository } from './AuthRepository.js';
export { interestRepository } from './InterestRepository.js';
export { locationRepository } from './LocationRepository.js';
export { tenantRepository } from './TenantRepository.js';
export { widgetRepository } from './WidgetRepository.js';

// Import classes for direct instantiation if needed
export { AuthRepository } from './AuthRepository.js';
export { InterestRepository } from './InterestRepository.js';
export { LocationRepository } from './LocationRepository.js';
export { TenantRepository } from './TenantRepository.js';
export { WidgetRepository } from './WidgetRepository.js';
export { BaseRepository } from './BaseRepository.js';

// Convenience object for accessing all repositories
export const repositories = {
  auth: authRepository,
  interests: interestRepository,
  location: locationRepository,
  tenant: tenantRepository,
  widgets: widgetRepository
};
