import type { Argv } from "yargs";
import { checkDuplicatesCommand } from "./inwx/check-duplicates.ts";
import { listCommand } from "./inwx/list.ts";
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
			listCommand(yargs);
			checkDuplicatesCommand(yargs);

			return yargs
				.demandCommand(1, "You need to specify a subcommand")
				.help()
				.example("$0 inwx test", "Test INWX connection")
				.example("$0 inwx status", "Check INWX account status")
				.example("$0 inwx list", "List all DNS records from INWX")
				.example("$0 inwx check-duplicates", "Check for problematic duplicate records");
		},
		handler: () => {
			// This handler will not be called if a subcommand is provided
			// yargs will automatically show help if no subcommand is specified
		},
	});
}
