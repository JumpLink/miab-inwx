import type { Argv } from "yargs";
import { getMiabStatus } from "../../actions/miab/status.ts";
import { getMiabConnectionFromEnv, printEnvExample } from "../../utils/env.ts";

interface StatusOptions {
	verbose?: boolean;
}

export function statusCommand(yargs: Argv): void {
	yargs.command({
		command: "status",
		describe: "Check the status of the MIAB server (credentials from .env file)",
		builder: (yargs: Argv) => {
			return yargs
				.option("verbose", {
					type: "boolean",
					description: "Enable verbose output",
					default: false,
				})
				.example("$0 miab status", "Check MIAB server status")
				.example("$0 miab status --verbose", "Check MIAB server status with verbose output");
		},
		handler: async (args: unknown) => {
			const statusOptions = args as StatusOptions;

			try {
				const connectionOptions = getMiabConnectionFromEnv(statusOptions.verbose || false);
				const result = await getMiabStatus(connectionOptions);

				if (result.success) {
					console.log(`✅ ${result.message}`);
					if (result.data) {
						console.log(`\n📊 Server Information:`);
						console.log(`  Base URL: ${result.data.baseUrl}`);
						console.log(`  Version: ${result.data.version || "N/A"}`);
						console.log(`  Total Checks: ${result.data.summary.totalChecks}`);
						console.log(`  Errors: ${result.data.summary.errors}`);
						console.log(`  Warnings: ${result.data.summary.warnings}`);
						console.log(`  OK: ${result.data.summary.ok}`);

						if (statusOptions.verbose && result.data) {
							console.log("\nConnection Details:");
							console.log(`  Base URL: ${result.data.baseUrl}`);
							console.log(`  Version: ${result.data.version || "N/A"}`);
							console.log(`  Reboot Required: ${result.data.rebootRequired ? "Yes" : "No"}`);
							console.log(`  Timestamp: ${result.data.timestamp}`);
						}
					}
				} else {
					console.error(`❌ ${result.error}`);
					process.exit(1);
				}
			} catch (error) {
				console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
				console.log("\n💡 Make sure you have a .env file with the required MIAB credentials:");
				printEnvExample();
				process.exit(1);
			}
		},
	});
}
