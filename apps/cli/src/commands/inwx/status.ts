import type { Argv } from "yargs";
import { getInwxStatus } from "../../actions/inwx/status.ts";
import { getInwxConnectionFromEnv, printEnvExample } from "../../utils/env.ts";

interface StatusOptions {
	verbose?: boolean;
	environment?: "ote" | "live";
}

export function statusCommand(yargs: Argv): void {
	yargs.command({
		command: "status",
		describe: "Check the status of the INWX account (credentials from .env file)",
		builder: (yargs: Argv) => {
			return yargs
				.option("verbose", {
					type: "boolean",
					description: "Enable verbose output",
					default: false,
				})
				.option("environment", {
					type: "string",
					choices: ["ote", "live"] as const,
					description: "INWX environment to use",
					default: "ote",
				})
				.example("$0 inwx status", "Check INWX account status (OTE environment)")
				.example("$0 inwx status --environment live", "Check INWX account status (Live environment)")
				.example("$0 inwx status --verbose", "Check INWX account status with verbose output")
				.example("$0 inwx status --environment live --verbose", "Check Live environment with verbose output");
		},
		handler: async (args: unknown) => {
			const statusOptions = args as StatusOptions;

			try {
				const connectionOptions = getInwxConnectionFromEnv(
					statusOptions.environment || "ote",
					statusOptions.verbose || false
				);
				const result = await getInwxStatus(connectionOptions);

				if (result.success) {
					console.log(`✅ ${result.message}`);

					if (result.data) {
						console.log(`\n📊 Account Information:`);
						console.log(`  Username: ${result.data.username}`);
						console.log(`  Environment: INWX ${result.data.environment.toUpperCase()}`);
						console.log(`  API URL: ${result.data.apiUrl}`);

						if (result.data.accountInfo.resData) {
							const accountData = result.data.accountInfo.resData;
							console.log(`  Payment Type: ${accountData.paymentType || "N/A"}`);
							console.log(`  Verification Level: ${accountData.verification || "N/A"}`);
							console.log(`  Premium Disabled: ${accountData.disablePremium ? "Yes" : "No"}`);
						}
					}

					if (statusOptions.verbose && result.data) {
						console.log("\nConnection Details:");
						console.log(`  Username: ${result.data.username}`);
						console.log(`  Environment: ${result.data.environment.toUpperCase()}`);
						console.log(`  API URL: ${result.data.apiUrl}`);
						console.log(`  Response Code: ${result.data.accountInfo.code}`);
						console.log(`  Response Message: ${result.data.accountInfo.msg}`);
						console.log(`  Timestamp: ${result.data.timestamp}`);
					}
				} else {
					console.error(`❌ ${result.error}`);
					process.exit(1);
				}
			} catch (error) {
				console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
				console.log("\n💡 Make sure you have a .env file with the required INWX credentials:");
				printEnvExample();
				process.exit(1);
			}
		},
	});
}
