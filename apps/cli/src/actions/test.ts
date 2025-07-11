import { MiabClient } from "@miab-inwx/miab-client";
import type { CommandResult, MiabConnectionOptions, TestData } from "../types/index.ts";

/**
 * Test the connection to the MIAB server
 */
export async function testMiabConnection(options: MiabConnectionOptions): Promise<CommandResult<TestData>> {
	try {
		const { apiUrl, email, password, verbose } = options;

		if (!apiUrl || !email || !password) {
			return {
				success: false,
				error: "Missing required MIAB connection parameters",
			};
		}

		if (verbose) {
			console.log(`Testing connection to ${apiUrl}...`);
		}

		// Configure the client with authentication
		const auth = `${email}:${password}`;
		const baseUrl = apiUrl.endsWith("/admin") ? apiUrl : `${apiUrl}/admin`;

		try {
			// Use the simplest API call to test connectivity and authentication
			const versionResponse = await MiabClient.getSystemVersion({
				baseUrl,
				auth,
				throwOnError: true,
			});

			return {
				success: true,
				message: "Connection and authentication successful",
				data: {
					url: apiUrl,
					baseUrl,
					authenticated: true,
					version: versionResponse.data || "Unknown",
					timestamp: new Date().toISOString(),
				},
			};
		} catch (apiError: unknown) {
			// Handle API-specific errors
			const error = apiError as { response?: { status?: number }; message?: string; code?: string };
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
			} else if (error.response?.status === 404) {
				return {
					success: false,
					error: "API endpoint not found. Please check the API URL.",
				};
			} else if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
				return {
					success: false,
					error: "Cannot connect to server. Please check the API URL and network connection.",
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
