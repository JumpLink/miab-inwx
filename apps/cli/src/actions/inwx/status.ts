import { ApiClient, Language } from "domrobot-client";
import type { InwxConnectionOptions, InwxStatusData } from "../../types/commands.ts";
import type { CommandResult } from "../../types/index.ts";

/**
 * Get the status of the INWX account
 */
export async function getInwxStatus(options: InwxConnectionOptions): Promise<CommandResult<InwxStatusData>> {
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
			console.log(`Getting INWX account status from ${environmentName} environment (${apiUrl})...`);
		}

		try {
			// Initialize API client
			const apiClient = new ApiClient(apiUrl, Language.EN, verbose);

			// Login first
			const loginResponse = await apiClient.login(username, password, sharedSecret);

			if (loginResponse.code !== 1000) {
				return {
					success: false,
					error: `Authentication failed (Code: ${loginResponse.code}): ${loginResponse.msg}`,
				};
			}

			// Get account information
			const accountInfoResponse = await apiClient.callApi("account.info", {});

			if (accountInfoResponse.code === 1000) {
				let statusMessage = "INWX account is active";
				if (accountInfoResponse.resData?.customer?.type === "blocked") {
					statusMessage = "INWX account is blocked";
				} else if (accountInfoResponse.resData?.balance && accountInfoResponse.resData.balance < 0) {
					statusMessage = "INWX account has negative balance";
				}

				return {
					success: true,
					message: statusMessage,
					data: {
						username,
						environment,
						apiUrl,
						accountInfo: {
							code: accountInfoResponse.code,
							msg: accountInfoResponse.msg,
							resData: accountInfoResponse.resData,
						},
						timestamp: new Date().toISOString(),
					},
				};
			} else {
				return {
					success: false,
					error: `Failed to get account information (Code: ${accountInfoResponse.code}): ${accountInfoResponse.msg}`,
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
			error: error instanceof Error ? error.message : "Status check failed",
		};
	}
}
