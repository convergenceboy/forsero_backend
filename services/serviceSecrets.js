// services/serviceSecrets.js
// Secret management service with Azure Key Vault interface
// Uses .env for local development and Azure Key Vault in production

import "dotenv/config"

// Determine if we're running in true production
// Production when NODE_ENV=production OR Azure Functions environment explicitly "Production"
const azureFunctionsEnvironment = process.env.AZURE_FUNCTIONS_ENVIRONMENT || ""
const isProduction = (process.env.NODE_ENV === "production") || (azureFunctionsEnvironment.toLowerCase() === "production")

let keyVaultClient = null
let credential = null

// Initialize Azure Key Vault for production
async function initializeAzureKeyVault() {
  if (!isProduction) return

  try {
    // These will be imported only in production to avoid dev dependency issues
    const { SecretClient } = await import("@azure/keyvault-secrets")
    const { DefaultAzureCredential } = await import("@azure/identity")

    const keyVaultUrl = process.env.AZURE_KEYVAULT_URL
    if (!keyVaultUrl) {
      throw new Error("AZURE_KEYVAULT_URL environment variable is required for production")
    }

    credential = new DefaultAzureCredential()
    keyVaultClient = new SecretClient(keyVaultUrl, credential)
    console.log(`Azure Key Vault initialized successfully: ${keyVaultUrl}`)
  } catch (error) {
    // Log the error but don't throw it
    console.error(`Failed to initialize Azure Key Vault: ${error.message}`)
    console.error(error.stack)
    return
  }
}

// Get secret value (works for both local and Azure Key Vault)
export async function getSecret(secretName) {
  try {
    // First check environment variables (from .env or system)
    const envValue = process.env[secretName];
    if (envValue) {
      console.log(`Using environment variable for '${secretName}'`);
      return envValue;
    }
    
    // Only try Key Vault in production
    if (isProduction && keyVaultClient) {
      try {
        // Production: Use Azure Key Vault
        console.log(`Retrieving secret '${secretName}' from Azure Key Vault`);
        const secret = await keyVaultClient.getSecret(secretName);
        console.log(`Successfully retrieved secret '${secretName}' from Azure Key Vault`);
        return secret.value;
      } catch (kvError) {
        console.error(`Azure Key Vault error for secret '${secretName}': ${kvError.message}`);
        console.error(kvError.stack);
        throw kvError; // Re-throw if Key Vault fails
      }
    }
    
    // If we get here, the secret wasn't found in .env or Key Vault
    console.warn(`Secret '${secretName}' not found in environment variables or Key Vault`);
    return null;
  } catch (error) {
    console.error(`Failed to retrieve secret '${secretName}':`, error)
    return null
  }
}

// Set secret value (not supported - use .env instead)
export function setSecret(secretName, value) {
  console.error("Setting secrets directly is not supported - use .env instead")
  return false
}

// List all available secrets (names only, not values)
export async function listSecrets() {
  try {
    if (isProduction && keyVaultClient) {
      // Production: List from Azure Key Vault
      const secrets = []
      for await (const secretProperties of keyVaultClient.listPropertiesOfSecrets()) {
        secrets.push(secretProperties.name)
      }
      return secrets
    } else {
      // Development: List from environment variables
      return Object.keys(process.env)
    }
  } catch (error) {
    console.error("Failed to list secrets:", error)
    return []
  }
}

// Initialize the service
export async function initializeSecretManager() {
  if (isProduction) {
    await initializeAzureKeyVault()
  } else {
    // Development: Using .env only
    console.log('Development mode: Using .env for secrets')
  }
}

// Helper function to get commonly used secrets
export async function getCommonSecrets() {
  const [jwtSecret, databaseUrl, hmacSecret] = await Promise.all([
    getSecret("JWT_SECRET"),
    getSecret("DATABASE_URL"),
    getSecret("HMAC_SECRET_KEY"),
  ])

  return {
    jwtSecret,
    databaseUrl,
    hmacSecret,
  }
}

// Health check for secret service
export async function healthCheck() {
  try {
    // Check if Key Vault client is initialized in production
    const keyVaultStatus = isProduction ? 
      (keyVaultClient ? "initialized" : "not-initialized") : "not-applicable";
    
    // Get Key Vault URL for diagnostics
    const keyVaultUrl = process.env.AZURE_KEYVAULT_URL || "not-configured";
    
    // Test secret retrieval
    const testSecret = await getSecret("JWT_SECRET");
    
    return {
      status: testSecret ? "healthy" : "unhealthy",
      mode: isProduction ? "azure-keyvault" : "local-development",
      keyVaultClient: keyVaultStatus,
      keyVaultUrl: keyVaultUrl,
      timestamp: new Date().toISOString(),
      environment: {
        isProduction: isProduction,
        nodeEnv: process.env.NODE_ENV || "not-set",
        azureFunctionsEnv: process.env.AZURE_FUNCTIONS_ENVIRONMENT || "not-set"
      }
    };
  } catch (error) {
    return {
      status: "error",
      mode: isProduction ? "azure-keyvault" : "local-development",
      keyVaultClient: isProduction ? 
        (keyVaultClient ? "initialized" : "not-initialized") : "not-applicable",
      keyVaultUrl: process.env.AZURE_KEYVAULT_URL || "not-configured",
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      environment: {
        isProduction: isProduction,
        nodeEnv: process.env.NODE_ENV || "not-set",
        azureFunctionsEnv: process.env.AZURE_FUNCTIONS_ENVIRONMENT || "not-set"
      }
    };
  }
}
