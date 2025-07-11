import type { Argv } from "yargs";
import { getMiabStatus } from "../../actions/miab/status.ts";
import { getMiabConnectionFromEnv, printEnvExample } from "../../utils/env.ts";
import { formatConnectionDetails, formatSystemStatus, getStatusIcon } from "../../utils/formatters.ts";

interface StatusOptions {
	verbose?: boolean;
}

export function statusCommand(yargs: Argv): void {
	yargs.command<StatusOptions>({
		command: "status",
		describe: "Check the status of the Mail-in-a-Box server (credentials from .env file)",
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
		handler: async (args: StatusOptions) => {
			try {
				const connectionOptions = getMiabConnectionFromEnv();
				const result = await getMiabStatus({
					...connectionOptions,
					verbose: args.verbose,
				});

				if (result.success) {
					const icon = getStatusIcon(result.data.summary.hasErrors, result.data.summary.hasWarnings);
					console.log(`${icon} ${result.message}`);

					if (result.data.status) {
						console.log(formatSystemStatus(result.data.status, args.verbose));
					}

					if (args.verbose && result.data) {
						console.log(formatConnectionDetails(result.data));
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
