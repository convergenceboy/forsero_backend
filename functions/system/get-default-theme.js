import {app} from '@azure/functions';
import {tenantRepository} from '../../repositories/index.js';

/**
 * Azure Function to get default theme configuration.
 *
 * v4 Azure Functions implementation of the legacy v3 `funcGetDefaultTheme`.
 *
 * @param {import('@azure/functions').HttpRequest} _request - Incoming HTTP request (unused).
 * @param {import('@azure/functions').InvocationContext} context - Function invocation context.
 * @returns {Promise<import('@azure/functions').HttpResponseInit>} HTTP response with default theme.
 */
async function systemGetDefaultThemeHandler(_request, context) {
	// Simple CORS headers
	const corsHeaders = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	};

	try {
		const defaultTheme = await tenantRepository.getDefaultTheme();

		return {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				...corsHeaders,
			},
			jsonBody: defaultTheme,
		};
	} catch (error) {
		context.log?.error?.('Error getting default theme:', error);

		return {
			status: 500,
			headers: {
				'Content-Type': 'application/json',
				...corsHeaders,
			},
			jsonBody: {
				error: 'Failed to get default theme',
				details: error.message,
			},
		};
	}
}

app.http('GetDefaultTheme', {
	methods: ['GET'],
	authLevel: 'anonymous',
	route: 'system/get-default-theme',
	handler: systemGetDefaultThemeHandler,
});

