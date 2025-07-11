import type { Argv } from "yargs";
import { getMiabStatus } from "../actions/status.ts";
import type { MiabConnectionOptions } from "../types/index.ts";
import { formatConnectionDetails, formatSystemStatus, getStatusIcon } from "../utils/formatters.ts";

interface StatusOptions extends MiabConnectionOptions {
	// Additional status-specific options can be added here
}

export function statusCommand(yargs: Argv): void {
	yargs.command<StatusOptions>({
		command: "status",
		describe: "Check the status of the Mail-in-a-Box server",
		builder: (yargs: Argv) => {
			return yargs
				.option("api-url", {
					alias: "u",
					type: "string",
					description: "MIAB API URL",
					demandOption: true,
				})
				.option("email", {
					alias: "e",
					type: "string",
					description: "MIAB admin email",
					demandOption: true,
				})
				.option("password", {
					alias: "p",
					type: "string",
					description: "MIAB admin password",
					demandOption: true,
				})
				.option("verbose", {
					type: "boolean",
					description: "Enable verbose output",
					default: false,
				})
				.example("$0 status -u https://box.example.com -e admin@example.com -p password", "Check MIAB server status");
		},
		handler: async (args: StatusOptions) => {
			const result = await getMiabStatus({
				apiUrl: args.apiUrl,
				email: args.email,
				password: args.password,
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
		},
	});
}
