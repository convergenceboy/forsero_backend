import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {databaseHealthCheck} from '../../services/serviceDatabase.js';
import {
	healthCheck as secretsHealthCheck,
	getSecret,
} from '../../services/serviceSecrets.js';

/**
 * Azure Function to verify secret resolution and health.
 * Includes database connectivity test for Azure Function App environment.
 *
 * This is the v4 Azure Functions implementation of the legacy v3
 * `funcGetHealth` HTTP-triggered function.
 *
 * @param {import('@azure/functions').HttpRequest} _request - Incoming HTTP request (unused).
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with health details.
 */
async function systemGetHealthHandler(_request, context) {
	await initializeApp();

	// 1. Test connectivity to Key Vault
	const secretsHealth = await secretsHealthCheck();

	// 2 & 3. Check and retrieve DATABASE-URL and HMAC key
	const databaseUrl = await getSecret('DATABASE_URL');
	const hmacKey = await getSecret('HMAC_SECRET_KEY');
	const jwtSecret = await getSecret('JWT_SECRET');

	// 4. Test database connectivity
	const dbHealth = await databaseHealthCheck();

	// Determine source of DATABASE_URL
	let databaseUrlSource = 'unknown';
	if (process.env.AZURE_FUNCTIONS_ENVIRONMENT) {
		if (secretsHealth.keyVaultClient === 'initialized') {
			databaseUrlSource = 'azure-keyvault';
		} else if (process.env.DATABASE_URL) {
			databaseUrlSource = 'environment-variable';
		} else {
			databaseUrlSource = 'local-secrets-fallback';
		}
	} else {
		databaseUrlSource = 'local-development';
	}

	context.log('GetHealth check completed', {
		keyVaultStatus: secretsHealth.status,
		dbStatus: dbHealth.status,
		databaseUrlSource,
	});

	return {
		status: 200,
		jsonBody: {
			keyVault: {
				status: secretsHealth.status,
				url: secretsHealth.keyVaultUrl,
				mode: secretsHealth.mode,
				clientInitialized: secretsHealth.keyVaultClient,
				environment: secretsHealth.environment,
			},
			databaseUrl: {
				retrieved: Boolean(databaseUrl),
				value: databaseUrl ?? 'Not available',
				source: databaseUrlSource,
			},
			hmacKey: {
				retrieved: Boolean(hmacKey),
				value: hmacKey ?? 'Not available',
				name: 'HMAC-SECRET-KEY',
			},
			jwtSecret: {
				retrieved: Boolean(jwtSecret),
				value: jwtSecret ?? 'Not available',
				name: 'JWT_SECRET',
			},
			databaseConnection: {
				status: dbHealth.status,
				timestamp: dbHealth.timestamp,
				poolStats: dbHealth.poolStats,
				error: dbHealth.error ?? null,
			},
		},
	};
}

app.http('GetHealth', {
	methods: ['GET'],
	authLevel: 'function',
	route: 'system/get-health',
	handler: systemGetHealthHandler,
});

