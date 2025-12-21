// services/serviceInit.js
// Application initialization service
// Handles startup sequence for Azure Functions with proper secret and database initialization

import { initializeSecretManager, healthCheck as secretsHealthCheck } from './serviceSecrets.js';
import { initializeDatabase, databaseHealthCheck } from './serviceDatabase.js';

let isInitialized = false;
let initializationPromise = null;

// Detect current environment
function detectEnvironment() {
  const azureEnv = (process.env.AZURE_FUNCTIONS_ENVIRONMENT || '').toLowerCase();
  const isAzure = azureEnv.length > 0; // any non-empty indicates Azure host
  const isProd = (process.env.NODE_ENV === 'production') || (azureEnv === 'production');

  if (isProd && isAzure) {
    return { name: 'Azure Production', type: 'production', platform: 'azure' };
  }
  if (isProd) {
    return { name: 'Production', type: 'production', platform: 'local' };
  }
  if (isAzure && azureEnv !== 'production') {
    return { name: 'Azure Development', type: 'development', platform: 'azure' };
  }
  return { name: 'Local Development', type: 'development', platform: 'local' };
}

// Initialize all services (call this in each Azure Function)
export async function initializeApp() {
  // Return existing promise if initialization is already in progress
  if (initializationPromise) {
    return initializationPromise;
  }
  
  // Return immediately if already initialized
  if (isInitialized) {
    return { status: 'already-initialized' };
  }
  
  // Start initialization
  initializationPromise = performInitialization();
  return initializationPromise;
}

async function performInitialization() {
  try {
    // Step 0: Detect and validate environment
    const environment = detectEnvironment();
    
    // Step 1: Initialize secret manager
    await initializeSecretManager();
    
    // Step 2: Initialize database with secrets
    await initializeDatabase();
    
    isInitialized = true;
    

    
    return {
      status: 'success',
      environment: environment.name,
      timestamp: new Date().toISOString(),
      services: ['secrets', 'database']
    };
  } catch (error) {
    // Reset state so retry is possible
    isInitialized = false;
    initializationPromise = null;
    
    throw error;
  }
}

// Health check for all services
export async function appHealthCheck() {
  if (!isInitialized) {
    return {
      status: 'not-initialized',
      timestamp: new Date().toISOString()
    };
  }
  
  try {
    const [secretsHealth, databaseHealth] = await Promise.all([
      secretsHealthCheck(),
      databaseHealthCheck()
    ]);
    
    const overallStatus = secretsHealth.status === 'healthy' && databaseHealth.status === 'healthy' 
      ? 'healthy' 
      : 'unhealthy';
    
    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        secrets: secretsHealth,
        database: databaseHealth
      }
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Reset initialization state (for testing)
export function resetInitialization() {
  isInitialized = false;
  initializationPromise = null;
}
