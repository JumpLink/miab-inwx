import type { Argv } from "yargs";
import { statusCommand } from "./inwx/status.ts";
import { testCommand } from "./inwx/test.ts";

/**
 * Main INWX command with subcommands
 */
export function inwxCommand(yargs: Argv): void {
	yargs.command({
		command: "inwx",
		describe: "INWX domain management commands",
		builder: (yargs: Argv) => {
			// Register subcommands
			statusCommand(yargs);
			testCommand(yargs);

			return yargs
				.demandCommand(1, "You need to specify a subcommand")
				.help()
				.example("$0 inwx test", "Test INWX connection")
				.example("$0 inwx status", "Check INWX account status");
		},
		handler: () => {
			// This handler will not be called if a subcommand is provided
			// yargs will automatically show help if no subcommand is specified
		},
	});
}
