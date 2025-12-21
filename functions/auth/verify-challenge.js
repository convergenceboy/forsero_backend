import {app} from '@azure/functions';
import {authRepository} from '../../repositories/AuthRepository.js';
import {initializeApp} from '../../services/serviceInit.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';
import {p256} from '@noble/curves/p256';
import {hexToBytes, utf8ToBytes} from '@noble/hashes/utils';
import {sha256} from '@noble/hashes/sha256';

/**
 * Verify challenge signature and authenticate user with multi-tenant support.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcVerifyChallenge`.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with authentication result.
 */
async function authVerifyChallengeHandler(request, context) {
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

		const {challengeId, signature} = body ?? {};

		if (!challengeId || !signature) {
			return {
				status: 400,
				jsonBody: {
					error: 'Missing required fields',
					required: ['challengeId', 'signature'],
				},
			};
		}

		// Retrieve challenge + user from tenant
		let challengeData;
		try {
			challengeData = await authRepository.getChallengeWithUser(
				tenant.id,
				challengeId,
			);
		} catch (dbError) {
			context.log?.error?.(
				'Database error occurred while fetching challenge for verification:',
				dbError,
			);

			return {
				status: 500,
				jsonBody: {error: 'Database error occurred'},
			};
		}

		if (!challengeData) {
			return {
				status: 404,
				jsonBody: {error: 'Invalid challenge'},
			};
		}

		// Check expiry / reuse
		if (new Date() > new Date(challengeData.expires_at)) {
			return {
				status: 401,
				jsonBody: {error: 'Challenge expired'},
			};
		}

		if (challengeData.used_at) {
			return {
				status: 401,
				jsonBody: {error: 'Challenge already used'},
			};
		}

		// Verify signature (client challenge only)
		const isValidSignature = await verifySignature(
			challengeData.challenge, // stored "nonce:timestamp[:serverSig]"
			signature, // compact hex (R||S) = 128 hex chars
			challengeData.public_key, // user's P-256 pubkey (66 or 130 hex)
		);

		if (!isValidSignature) {
			return {
				status: 401,
				jsonBody: {error: 'Invalid signature'},
			};
		}

		// Mark challenge as used (best-effort)
		try {
			await authRepository.markChallengeAsUsed(tenant.id, challengeId);
		} catch (markError) {
			context.log?.warn?.(
				'Failed to mark challenge as used (continuing anyway):',
				markError,
			);
		}

		// Update last_login timestamp (best-effort, don't fail auth if this fails)
		try {
			await authRepository.updateLastLogin(tenant.id, challengeData.user_id);
		} catch (loginUpdateError) {
			context.log?.warn?.(
				'Failed to update last_login (continuing anyway):',
				loginUpdateError,
			);
		}

		// Generate JWT token using AuthRepository (secure secret management + unified token format)
		let token;
		try {
			token = await authRepository.generateToken(
				challengeData.user_id,
				challengeData.email || `${challengeData.username}@${tenant.key}`,
				challengeData.username,
				tenant.id,
			);
		} catch (tokenError) {
			context.log?.error?.('Token generation failed:', tokenError);

			return {
				status: 500,
				jsonBody: {error: 'Token generation failed'},
			};
		}

		// Success
		return {
			status: 200,
			jsonBody: {
				success: true,
				token,
				user: {
					user_id: challengeData.user_id,
					username: challengeData.username,
					tenant: tenant.displayName,
				},
				message: 'Authentication successful',
			},
		};
	} catch (error) {
		context.log?.error?.('Internal error in VerifyChallenge:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

/**
 * Verify an ECDSA P-256 signature against the client-visible challenge ("nonce:timestamp").
 * - Accepts compressed (66 hex) OR uncompressed (130 hex) public keys.
 * - Reconstructs client string from stored "nonce:timestamp:serverSig".
 *
 * @param {string} storedChallenge - "nonce:timestamp[:serverSig]".
 * @param {string} signature - Compact ECDSA signature hex (R||S = 64B -> 128 hex).
 * @param {string} publicKey - P-256 public key hex (66 or 130).
 * @returns {Promise<boolean>} Whether the signature is valid.
 */
async function verifySignature(storedChallenge, signature, publicKey) {
	try {
		// Basic presence checks
		if (!signature || !storedChallenge || !publicKey) {
			return false;
		}

		// Signature length: compact R||S = 128 hex
		if (!isValidCompactSigHex(signature)) {
			return false;
		}

		// Public key: 66 (compressed) or 130 (uncompressed) hex, prefix 02/03/04
		if (!isValidP256PubHex(publicKey)) {
			return false;
		}

		// Rebuild client-visible string ("nonce:timestamp") from stored challenge
		const {clientChallenge} = parseStoredChallenge(storedChallenge);

		// Parse values into bytes (no Buffer)
		let signatureObject;
		try {
			signatureObject = p256.Signature.fromCompact(hexToBytes(signature));
		} catch {
			return false;
		}

		let publicKeyBytes;
		try {
			publicKeyBytes = hexToBytes(publicKey);
		} catch {
			return false;
		}

		const digest = sha256(utf8ToBytes(clientChallenge));

		// Verify against the SHA-256 digest, same as client signs
		const isValid = p256.verify(signatureObject, digest, publicKeyBytes);

		return isValid;
	} catch {
		return false;
	}
}

/**
 * Check whether a string is valid hex.
 *
 * @param {string} value - Value to test.
 * @returns {boolean} Whether the string is valid hex.
 */
function isHex(value) {
	return (
		typeof value === 'string' &&
		value.length % 2 === 0 &&
		/^[0-9a-f]+$/i.test(value)
	);
}

/**
 * Validate compact ECDSA signature hex (R||S).
 *
 * @param {string} hex - Signature hex string.
 * @returns {boolean} Whether the signature is valid compact hex.
 */
function isValidCompactSigHex(hex) {
	return isHex(hex) && hex.length === 128; // 64-byte compact
}

/**
 * Validate a P-256 public key hex string (compressed or uncompressed).
 *
 * @param {string} hex - Public key hex string.
 * @returns {boolean} Whether the public key is valid hex for P-256.
 */
function isValidP256PubHex(hex) {
	if (!isHex(hex)) {
		return false;
	}

	if (hex.length !== 66 && hex.length !== 130) {
		return false;
	}

	const prefix = hex.slice(0, 2);

	return prefix === '02' || prefix === '03' || prefix === '04';
}

/**
 * Parse a stored challenge string of the form "nonce:timestamp[:serverSig]".
 *
 * @param {string} stored - Stored challenge string.
 * @returns {{ clientChallenge: string }} Parsed client challenge.
 */
function parseStoredChallenge(stored) {
	const parts = String(stored ?? '').split(':');

	if (parts.length < 2) {
		throw new Error('Malformed stored challenge');
	}

	return {
		clientChallenge: `${parts[0]}:${parts[1]}`,
	};
}

app.http('VerifyChallenge', {
	methods: ['POST'],
	authLevel: 'function',
	route: 'auth/verify-challenge',
	handler: authVerifyChallengeHandler,
});


