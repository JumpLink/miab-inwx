import type { Argv } from "yargs";
import { listCommand } from "./miab/list.ts";
import { statusCommand } from "./miab/status.ts";
import { testCommand } from "./miab/test.ts";

/**
 * Main MIAB command with subcommands
 */
export function miabCommand(yargs: Argv): void {
	yargs.command({
		command: "miab",
		describe: "Mail-in-a-Box server management commands",
		builder: (yargs: Argv) => {
			// Register subcommands
			statusCommand(yargs);
			testCommand(yargs);
			listCommand(yargs);

			return yargs
				.demandCommand(1, "You need to specify a subcommand")
				.help()
				.example("$0 miab status", "Check MIAB server status")
				.example("$0 miab test", "Test MIAB server connection")
				.example("$0 miab list", "List all DNS records from MIAB");
		},
		handler: () => {
			// This handler will not be called if a subcommand is provided
			// yargs will automatically show help if no subcommand is specified
		},
	});
}
