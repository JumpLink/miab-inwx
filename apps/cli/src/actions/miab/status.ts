import { MiabClient, type SystemStatusResponse } from "@miab-inwx/miab-client";
import type { CommandResult, MiabConnectionOptions } from "../../types/index.ts";
import type { StatusData } from "../../types/miab-status.ts";

/**
 * Get the status of the Mail-in-a-Box server
 */
export async function getMiabStatus(options: MiabConnectionOptions): Promise<CommandResult<StatusData>> {
	try {
		const { apiUrl, email, password, verbose } = options;

		if (!apiUrl || !email || !password) {
			return {
				success: false,
				error: "Missing required MIAB connection parameters: apiUrl, email, password",
			};
		}

		if (verbose) {
			console.log(`Checking MIAB status at ${apiUrl}...`);
		}

		// Configure the client with authentication
		const auth = `${email}:${password}`;
		const baseUrl = apiUrl.endsWith("/admin") ? apiUrl : `${apiUrl}/admin`;

		try {
			// Get system status
			const statusResponse = await MiabClient.getSystemStatus({
				baseUrl,
				auth,
				throwOnError: true,
			});

			if (verbose) {
				console.log("Raw API Response:", statusResponse);
			}

			// Get additional system info if verbose mode is enabled
			let additionalInfo = {};
			if (verbose) {
				try {
					const [versionResponse, rebootResponse] = await Promise.all([
						MiabClient.getSystemVersion({ baseUrl, auth, throwOnError: false }),
						MiabClient.getSystemRebootStatus({ baseUrl, auth, throwOnError: false }),
					]);

					additionalInfo = {
						version: versionResponse.data || "Unknown",
						rebootRequired: rebootResponse.data || false,
					};
				} catch (error) {
					// Additional info is optional, don't fail if we can't get it
					if (verbose) {
						console.log("Could not fetch additional system info:", error);
					}
				}
			}

			// Process the status response
			const statusData = statusResponse.data as SystemStatusResponse;
			const hasErrors = statusData.some((entry) => entry.type === "error");
			const hasWarnings = statusData.some((entry) => entry.type === "warning");

			let statusMessage = "MIAB server is running";
			if (hasErrors) {
				statusMessage = "MIAB server has errors";
			} else if (hasWarnings) {
				statusMessage = "MIAB server has warnings";
			}

			return {
				success: true,
				message: statusMessage,
				data: {
					url: apiUrl,
					baseUrl,
					status: statusData,
					summary: {
						totalChecks: statusData.length,
						errors: statusData.filter((entry) => entry.type === "error").length,
						warnings: statusData.filter((entry) => entry.type === "warning").length,
						ok: statusData.filter((entry) => entry.type === "ok").length,
						hasErrors,
						hasWarnings,
					},
					...additionalInfo,
					timestamp: new Date().toISOString(),
				},
			};
		} catch (apiError: unknown) {
			// Handle API-specific errors
			const error = apiError as { response?: { status?: number }; message?: string };
			if (error.response?.status === 401) {
				return {
					success: false,
					error: "Authentication failed. Please check your email and password.",
				};
			} else if (error.response?.status === 403) {
				return {
					success: false,
					error: "Access denied. Please check your permissions.",
				};
			} else if (error.response?.status && error.response.status >= 500) {
				return {
					success: false,
					error: "Server error. The MIAB server may be experiencing issues.",
				};
			} else {
				return {
					success: false,
					error: `API Error: ${error.message || "Unknown API error"}`,
				};
			}
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		};
	}
}
