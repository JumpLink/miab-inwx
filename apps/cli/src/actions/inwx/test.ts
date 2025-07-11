import { ApiClient, Language } from "domrobot-client";
import type { InwxConnectionOptions, InwxTestData } from "../../types/commands.ts";
import type { CommandResult } from "../../types/index.ts";

/**
 * Test the connection to the INWX API
 */
export async function testInwxConnection(options: InwxConnectionOptions): Promise<CommandResult<InwxTestData>> {
	try {
		const { username, password, sharedSecret, environment = "ote", verbose } = options;

		if (!username || !password) {
			return {
				success: false,
				error: "Missing required INWX connection parameters: username, password",
			};
		}

		const isOte = environment === "ote";
		const apiUrl = isOte ? ApiClient.API_URL_OTE : ApiClient.API_URL_LIVE;
		const environmentName = isOte ? "OTE (Test)" : "Live (Production)";

		if (verbose) {
			console.log(`Testing INWX connection to ${environmentName} environment (${apiUrl})...`);
		}

		try {
			// Initialize API client
			const apiClient = new ApiClient(apiUrl, Language.EN, verbose);

			// Test connection with login
			const loginResponse = await apiClient.login(username, password, sharedSecret);

			if (loginResponse.code === 1000) {
				// Login successful
				return {
					success: true,
					message: `Connection and authentication successful to ${environmentName}`,
					data: {
						username,
						environment,
						apiUrl,
						authenticated: true,
						loginResponse: {
							code: loginResponse.code,
							msg: loginResponse.msg,
							resData: loginResponse.resData,
						},
						timestamp: new Date().toISOString(),
					},
				};
			} else {
				// Login failed
				return {
					success: false,
					error: `Authentication failed (Code: ${loginResponse.code}): ${loginResponse.msg}`,
				};
			}
		} catch (apiError: unknown) {
			// Handle API connection errors
			const error = apiError as { message?: string; code?: string };

			if (error.code === "ECONNREFUSED") {
				return {
					success: false,
					error: "Cannot connect to INWX API server. Please check your internet connection.",
				};
			} else if (error.code === "ENOTFOUND") {
				return {
					success: false,
					error: "INWX API server not found. Please check the API URL.",
				};
			} else {
				return {
					success: false,
					error: `Connection failed: ${error.message || "Unknown error"}`,
				};
			}
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Connection test failed",
		};
	}
}
