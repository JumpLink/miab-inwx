import { ApiClient, Language } from "domrobot-client";
import type { Argv } from "yargs";
import { getInwxConnectionFromEnv, getMiabConnectionFromEnv, loadEnvConfig, printEnvExample } from "../utils/env.ts";

export function debugCommand(yargs: Argv): void {
	yargs.command({
		command: "debug",
		describe: "Show environment variable debug information",
		builder: (yargs: Argv) => {
			return yargs
				.option("test-zone", {
					type: "string",
					description: "Test DNS zone creation with this domain name",
				})
				.option("list-domains", {
					type: "boolean",
					description: "List all domains in the INWX account",
				})
				.option("environment", {
					type: "string",
					choices: ["ote", "live"] as const,
					description: "INWX environment to use for testing",
					default: "ote",
				})
				.option("verbose", {
					type: "boolean",
					description: "Enable verbose output",
					default: false,
				})
				.example("$0 debug", "Show environment configuration")
				.example("$0 debug --test-zone test.example.com", "Test DNS zone creation")
				.example("$0 debug --list-domains", "List all domains in INWX account")
				.example("$0 debug --environment live --verbose", "Debug with Live environment and verbose output");
		},
		handler: async (args: unknown) => {
			const options = args as { 
				"test-zone"?: string; 
				"list-domains"?: boolean; 
				environment?: "ote" | "live";
				verbose?: boolean;
			};

			if (options["test-zone"]) {
				await testZoneCreation(options["test-zone"], options.environment || "ote", options.verbose || false);
				return;
			}

			if (options["list-domains"]) {
				await listDomains(options.environment || "ote", options.verbose || false);
				return;
			}

			console.log("🔍 Environment Variable Debug Information\n");

			try {
				const _envConfig = loadEnvConfig();
				console.log("📂 Environment file locations checked:");
				console.log("   - Project root: .env");
				console.log("   - CLI directory: apps/cli/.env");
				console.log("   - Current directory: .env");
				console.log("");

				console.log("🔧 MIAB Configuration:");
				try {
					const miabConnection = getMiabConnectionFromEnv(options.verbose || false);
					console.log(`   ✅ MIAB_URL: ${miabConnection.apiUrl}`);
					console.log(`   ✅ MIAB_USERNAME: ${miabConnection.email}`);
					console.log(`   ✅ MIAB_PASSWORD: ${miabConnection.password ? "[SET]" : "[NOT SET]"}`);
				} catch (error) {
					console.log(`   ❌ MIAB Configuration Error: ${error instanceof Error ? error.message : "Unknown error"}`);
				}

				console.log("\n🌐 INWX Configuration:");
				const environment = options.environment || "ote";
				try {
					const inwxConnection = getInwxConnectionFromEnv(environment, options.verbose || false);
					console.log(`   ✅ INWX_USERNAME: ${inwxConnection.username}`);
					console.log(`   ✅ INWX_PASSWORD: ${inwxConnection.password ? "[SET]" : "[NOT SET]"}`);
					console.log(`   ✅ INWX_SHARED_SECRET: ${inwxConnection.sharedSecret ? "[SET]" : "[NOT SET]"}`);
					console.log(`   ✅ INWX_ENVIRONMENT: ${inwxConnection.environment} (from CLI: ${environment})`);
				} catch (error) {
					console.log(`   ❌ INWX Configuration Error: ${error instanceof Error ? error.message : "Unknown error"}`);
				}

				console.log("\n⚙️  General Configuration:");
				console.log(`   VERBOSE: ${options.verbose ? "enabled" : "disabled"} (CLI argument)`);
				console.log(`   NODE_ENV: ${process.env.NODE_ENV || "development"}`);

				console.log("\n📋 All Environment Variables:");
				const envVars = Object.entries(process.env)
					.filter(([key]) => key.startsWith("MIAB_") || key.startsWith("INWX_"))
					.map(
						([key, value]) =>
							`   ${key}: ${value?.length ? (key.includes("PASSWORD") || key.includes("SECRET") ? "[SET]" : value) : "[NOT SET]"}`,
					);

				if (envVars.length > 0) {
					console.log(envVars.join("\n"));
				} else {
					console.log("   No relevant environment variables found");
				}

				console.log("\n💡 Note: VERBOSE and INWX_ENVIRONMENT are now CLI-only options:");
				console.log("   Use --verbose for detailed output");
				console.log("   Use --environment ote|live to select INWX environment");
			} catch (error) {
				console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
				console.log("\n💡 Make sure you have a .env file with the required credentials:");
				printEnvExample();
			}
		},
	});
}

async function testZoneCreation(domain: string, environment: "ote" | "live", verbose: boolean): Promise<void> {
	console.log(`🧪 Testing DNS zone creation for: ${domain}\n`);

	try {
		const inwxConnection = getInwxConnectionFromEnv(environment, verbose);
		const isOte = environment === "ote";

		console.log(`🔧 Connecting to INWX ${isOte ? "OTE (Test)" : "Live"} environment...`);

		const inwxApiClient = new ApiClient(inwxConnection.environment === "ote" ? ApiClient.API_URL_OTE : ApiClient.API_URL_LIVE, Language.EN, verbose);

		// Login
		console.log("🔐 Logging in...");
		const loginResponse = await inwxApiClient.login(
			inwxConnection.username,
			inwxConnection.password,
			inwxConnection.sharedSecret,
		);

		if (loginResponse.code !== 1000) {
			console.error(`❌ Login failed: ${loginResponse.msg}`);
			return;
		}

		console.log("✅ Login successful");

		// Check if zone exists
		console.log(`🔍 Checking if zone ${domain} exists...`);
		const zoneInfoResponse = await inwxApiClient.callApi("nameserver.info", {
			domain: domain,
		});

		if (zoneInfoResponse.code === 1000) {
			console.log(`✅ Zone ${domain} already exists`);
			console.log(`   Zone ID: ${zoneInfoResponse.resData?.id}`);
			console.log(`   Zone Type: ${zoneInfoResponse.resData?.type}`);
		} else if (zoneInfoResponse.code === 2303) {
			console.log(`ℹ️  Zone ${domain} does not exist`);

			// Check if domain is registered
			console.log(`🔍 Checking if domain ${domain} is registered...`);
			const domainListResponse = await inwxApiClient.callApi("domain.list", {});

			if (domainListResponse.code === 1000) {
				const domains = domainListResponse.resData?.domains || [];
				const isDomainRegistered = domains.some(
					(registeredDomain: { domain: string }) => registeredDomain.domain === domain,
				);

				if (isDomainRegistered) {
					console.log(`✅ Domain ${domain} is registered`);
					console.log(`💡 You can create a DNS zone for this domain`);
				} else {
					console.log(`❌ Domain ${domain} is not registered in your INWX account`);
					console.log(`💡 You need to register the domain before creating a DNS zone`);
				}
			} else {
				console.error(`❌ Failed to check domain registration: ${domainListResponse.msg}`);
			}
		} else {
			console.error(`❌ Failed to check zone: ${zoneInfoResponse.msg}`);
		}

		// Logout
		try {
			await inwxApiClient.logout();
			console.log("\n🔓 Logged out successfully");
		} catch (_error) {
			console.log("⚠️  Logout error (ignored)");
		}
	} catch (error) {
		console.error(`❌ Failed to test zone creation: ${error instanceof Error ? error.message : String(error)}`);
		console.log("\n💡 Make sure you have a .env file with the required INWX credentials:");
		printEnvExample();
	}
}

async function listDomains(environment: "ote" | "live", verbose: boolean): Promise<void> {
	console.log("🔍 Listing all domains in INWX account...\n");

	try {
		const inwxConnection = getInwxConnectionFromEnv(environment, verbose);
		const isOte = environment === "ote";

		console.log(`🔧 Connecting to INWX ${isOte ? "OTE (Test)" : "Live"} environment...`);

		const inwxApiClient = new ApiClient(inwxConnection.environment === "ote" ? ApiClient.API_URL_OTE : ApiClient.API_URL_LIVE, Language.EN, verbose);

		// Login
		console.log("🔐 Logging in...");
		const loginResponse = await inwxApiClient.login(
			inwxConnection.username,
			inwxConnection.password,
			inwxConnection.sharedSecret,
		);

		if (loginResponse.code !== 1000) {
			console.error(`❌ Login failed: ${loginResponse.msg}`);
			return;
		}

		console.log("✅ Login successful");

		// List domains
		console.log("📋 Fetching domain list...");
		const domainListResponse = await inwxApiClient.callApi("domain.list", {});

		if (domainListResponse.code === 1000) {
			console.log("✅ Domain list retrieved successfully");

			if (domainListResponse.resData?.domains) {
				const domains = domainListResponse.resData.domains;
				console.log(`\n📌 Found ${domains.length} domains in your account:`);

				domains.forEach((domain: { domain: string; status?: string; [key: string]: unknown }, index: number) => {
					console.log(`  ${index + 1}. ${domain.domain} (Status: ${domain.status})`);
				});
			} else {
				console.log("⚠️  No domains found or unexpected response format");
			}
		} else {
			console.error(`❌ Failed to list domains: ${domainListResponse.msg}`);
			console.error(`   Error Code: ${domainListResponse.code}`);
		}

		// List nameservers
		console.log("\n📋 Fetching nameserver list...");
		const nameserverListResponse = await inwxApiClient.callApi("nameserver.list", {});

		if (nameserverListResponse.code === 1000) {
			console.log("✅ Nameserver list retrieved successfully");

			if (nameserverListResponse.resData?.domains) {
				const nameservers = nameserverListResponse.resData.domains;
				console.log(`\n🗄️  Found ${nameservers.length} DNS zones configured:`);

				nameservers.forEach((ns: { domain: string; type?: string; [key: string]: unknown }, index: number) => {
					console.log(`  ${index + 1}. ${ns.domain} (Type: ${ns.type})`);
				});
			} else {
				console.log("⚠️  No nameservers found or unexpected response format");
			}
		} else {
			console.error(`❌ Failed to list nameservers: ${nameserverListResponse.msg}`);
			console.error(`   Error Code: ${nameserverListResponse.code}`);
		}

		// Logout
		try {
			await inwxApiClient.logout();
			console.log("\n🔓 Logged out successfully");
		} catch (_error) {
			console.log("⚠️  Logout error (ignored)");
		}
	} catch (error) {
		console.error(`❌ Failed to list domains: ${error instanceof Error ? error.message : String(error)}`);
		console.log("\n💡 Make sure you have a .env file with the required INWX credentials:");
		printEnvExample();
	}
}
