import crypto from 'crypto';
import {app} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {authRepository} from '../../repositories/AuthRepository.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';

/**
 * Generate authentication challenge for passwordless login with multi-tenant
 * support. Implements sophisticated challenge format with rate limiting.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcRequestChallenge`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with challenge data.
 */
async function authRequestChallengeHandler(request, context) {
	let tenant = null;

	try {
		// Initialize services (non-fatal if initialization fails; log and continue).
		try {
			await initializeApp();
		} catch (initError) {
			context.log?.warn?.('Service initialization failed:', initError.message);
		}

		// Resolve tenant from request
		try {
			tenant = await resolveTenant(request);

			if (!validateTenantAccess(tenant, 'read')) {
				return {
					status: 403,
					jsonBody: {error: 'Tenant access denied'},
				};
			}
		} catch (tenantError) {
			context.log?.warn?.('Tenant resolution/validation failed:', tenantError);

			return {
				status: 400,
				jsonBody: {error: 'Invalid tenant configuration'},
			};
		}

		// Input validation
		let body;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const {username, clientTimestamp} = body ?? {};

		if (!username || !clientTimestamp) {
			return {
				status: 400,
				jsonBody: {
					error: 'Missing required fields',
					required: ['username', 'clientTimestamp'],
				},
			};
		}

		// Check if user exists in tenant
		let user;
		try {
			user = await authRepository.getUserByUsername(tenant.id, username);
		} catch (dbError) {
			context.log?.error?.(
				'Database error occurred while fetching user for challenge:',
				dbError,
			);

			return {
				status: 500,
				jsonBody: {error: 'Database error occurred'},
			};
		}

		if (!user) {
			return {
				status: 404,
				jsonBody: {error: 'User not found'},
			};
		}

		// Rate limiting check
		const rateLimitResult = await authRepository.checkChallengeRateLimit(
			tenant.id,
			user.id,
		);
		if (!rateLimitResult.allowed) {
			return {
				status: 429,
				jsonBody: {
					error: 'Rate limit exceeded',
					retryAfter: rateLimitResult.retryAfter,
				},
			};
		}

		// Generate sophisticated challenge
		const challenge = generateSophisticatedChallenge();

		// Store challenge with expiration
		const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
		let challengeId;

		try {
			challengeId = await authRepository.createAuthChallenge(
				tenant.id,
				user.id,
				challenge.fullChallenge,
				expiresAt,
				clientTimestamp ? new Date(clientTimestamp) : new Date(),
			);
		} catch (dbError) {
			context.log?.error?.(
				'Database error during challenge creation:',
				dbError,
			);

			return {
				status: 500,
				jsonBody: {error: 'Database error during challenge creation'},
			};
		}

		return {
			status: 200,
			jsonBody: {
				challenge: challenge.clientChallenge,
				expiresAt: expiresAt.toISOString(),
				challengeId,
				tenant: tenant.displayName,
			},
		};
	} catch (error) {
		context.log?.error?.('Internal error in RequestChallenge:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

/**
 * Generate sophisticated challenge with nonce + timestamp + server signature.
 */
function generateSophisticatedChallenge() {
	const nonce = generateSecureRandom(32); // 32 byte random
	const timestamp = Date.now();

	// Create server signature using a simple secret
	const serverSecret =
		process.env.JWT_SECRET ??
		'your-super-secret-jwt-key-change-in-production-make-it-long-and-random';
	const signatureInput = `${nonce}:${timestamp}`;
	const serverSignature = crypto
		.createHmac('sha256', serverSecret)
		.update(signatureInput)
		.digest('hex');

	const fullChallenge = `${nonce}:${timestamp}:${serverSignature}`;
	const clientChallenge = `${nonce}:${timestamp}`; // Client doesn't need server signature

	return {
		fullChallenge,
		clientChallenge,
		nonce,
		timestamp,
	};
}

/**
 * Generate cryptographically secure random string.
 *
 * @param {number} bytes - Number of random bytes.
 * @returns {string} Hex-encoded secure random string.
 */
function generateSecureRandom(bytes) {
	return crypto.randomBytes(bytes).toString('hex');
}

app.http('RequestChallenge', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'auth/request-challenge',
	handler: authRequestChallengeHandler,
});

