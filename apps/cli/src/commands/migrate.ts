import type { Argv } from "yargs";
import { checkDomainsCommand } from "./migrate/check-domains.ts";
import { dnsCommand } from "./migrate/dns.ts";

/**
 * Main migrate command with subcommands
 */
export function migrateCommand(yargs: Argv): void {
	yargs.command({
		command: "migrate",
		describe: "Data migration commands between MIAB and INWX",
		builder: (yargs: Argv) => {
			// Register subcommands
			dnsCommand(yargs);
			checkDomainsCommand(yargs);

			return yargs
				.demandCommand(1, "You need to specify a subcommand")
				.help()
				.example("$0 migrate dns --dry-run", "Test DNS migration without making changes")
				.example("$0 migrate dns", "Migrate DNS records from MIAB to INWX")
				.example("$0 migrate check-domains", "Check which MIAB domains exist in INWX");
		},
		handler: () => {
			// This handler will not be called if a subcommand is provided
			// yargs will automatically show help if no subcommand is specified
		},
	});
}
