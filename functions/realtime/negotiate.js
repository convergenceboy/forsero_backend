import {app, input} from '@azure/functions';
import {initializeApp} from '../../services/serviceInit.js';
import {resolveTenant, validateTenantAccess} from '../../services/serviceTenant.js';
import {authRepository} from '../../repositories/AuthRepository.js';

/**
 * Negotiate a Socket.IO/Web PubSub connection for an authenticated user.
 *
 * v4 Azure Functions implementation of the legacy v3 `tayab_funcNegotiate`.
 *
 * Responsibilities:
 * - Initialize application services (secrets, database).
 * - Resolve and validate tenant access.
 * - Validate JWT-based authentication.
 * - Invoke the `socketionegotiation` binding to obtain negotiation metadata.
 *
 * @param {import('@azure/functions').HttpRequest} request - Incoming HTTP request.
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with negotiation payload.
 */
async function realtimeNegotiateHandler(request, context) {
	let tenant = null;

	try {
		// Initialize services (non-fatal on failure; log and continue).
		try {
			await initializeApp();
		} catch (initError) {
			context.log?.warn?.(
				'Service initialization failed in RealtimeNegotiate:',
				initError?.message ?? initError,
			);
		}

		// Resolve tenant from request and validate access.
		try {
			tenant = await resolveTenant(request);

			if (!validateTenantAccess(tenant, 'read')) {
				return {
					status: 403,
					jsonBody: {error: 'Tenant access denied'},
				};
			}
		} catch (tenantError) {
			context.log?.warn?.(
				'Tenant resolution/validation failed in RealtimeNegotiate:',
				tenantError,
			);

			return {
				status: 400,
				jsonBody: {error: 'Invalid tenant domain'},
			};
		}

		// Extract and validate authentication from headers.
		try {
			// Normalize Azure Functions v4 HttpRequest headers into the plain
			// object shape expected by AuthRepository.extractAuthFromRequest.
			let headersObject = request.headers;

			if (headersObject && typeof headersObject.entries === 'function') {
				headersObject = Object.fromEntries(headersObject.entries());
			}

			await authRepository.extractAuthFromRequest({headers: headersObject});
		} catch (authError) {
			context.log?.warn?.(
				'Authentication required for realtime negotiation:',
				authError?.message ?? authError,
			);

			return {
				status: 401,
				jsonBody: {error: 'Authentication required'},
			};
		}

		// Retrieve negotiation result from the Socket.IO negotiation binding.
		const negotiateResult =
			context.extraInputs?.get(socketIONegotiateInput) ?? null;

		if (!negotiateResult) {
			context.log?.error?.(
				'RealtimeNegotiate: missing negotiation result from binding.',
			);

			return {
				status: 500,
				jsonBody: {error: 'Negotiation failed'},
			};
		}

		context.log?.info?.('RealtimeNegotiate success', {
			tenant: tenant?.displayName,
		});

		return {
			status: 200,
			jsonBody: negotiateResult,
		};
	} catch (error) {
		context.log?.error?.('Internal error in RealtimeNegotiate:', error);

		return {
			status: 500,
			jsonBody: {error: 'Internal server error'},
		};
	}
}

// Socket.IO negotiation binding (Web PubSub for Socket.IO, serverless mode).
const socketIONegotiateInput = input.generic({
	type: 'socketionegotiation',
	direction: 'in',
	name: 'negotiateResult',
	hub: 'hub',
	// Preserve original v3 behavior: user identity is derived from the
	// `userId` query parameter, e.g. `/api/realtime/negotiate?userId=123`.
	userId: '{query.userId}',
});

app.http('RealtimeNegotiate', {
	methods: ['GET', 'POST'],
	authLevel: 'function',
	route: 'realtime/negotiate',
	extraInputs: [socketIONegotiateInput],
	handler: realtimeNegotiateHandler,
});

