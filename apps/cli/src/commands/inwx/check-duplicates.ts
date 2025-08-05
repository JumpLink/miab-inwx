import type { Argv } from "yargs";
import { checkInwxDuplicates } from "../../actions/inwx/check-duplicates.ts";
import { getInwxConnectionFromEnv, printEnvExample } from "../../utils/env.ts";

interface CheckDuplicatesOptions {
	environment?: "ote" | "live";
	domains?: string[];
	verbose?: boolean;
}

export function checkDuplicatesCommand(yargs: Argv): void {
	yargs.command({
		command: "check-duplicates",
		describe: "Check for problematic duplicate DNS records in INWX zones (credentials from .env file)",
		builder: (yargs: Argv) => {
			return yargs
				.option("environment", {
					type: "string",
					choices: ["ote", "live"] as const,
					default: "ote",
					describe: "INWX environment to use",
				})
				.option("domains", {
					type: "array",
					string: true,
					describe: "Specific domains to check (default: all domains in account)",
				})
				.option("verbose", {
					type: "boolean",
					default: false,
					describe: "Enable verbose output",
				})
				.example("$0 inwx check-duplicates", "Check all zones for duplicates")
				.example("$0 inwx check-duplicates --domains example.com test.com", "Check specific domains")
				.example(
					"$0 inwx check-duplicates --environment live --verbose",
					"Check production environment with verbose output",
				);
		},
		handler: async (args: unknown) => {
			const options = args as CheckDuplicatesOptions;

			try {
				const connectionOptions = getInwxConnectionFromEnv(options.environment || "ote", options.verbose || false);

				const result = await checkInwxDuplicates({
					...connectionOptions,
					domains: options.domains,
				});

				if (result.success) {
					console.log("✅", result.message);

					if (result.data.duplicates.totalDuplicateIssues > 0) {
						console.log("\n🔍 Found problematic duplicates:");
						for (const zone of result.data.duplicates.duplicatesByZone) {
							console.log(`\n📋 Zone: ${zone.domain}`);
							for (const duplicate of zone.duplicates) {
								console.log(`   ❌ ${duplicate.type} ${duplicate.name}`);
								console.log(`      Reason: ${duplicate.reason}`);
								console.log(`      Records:`);
								for (const record of duplicate.records) {
									console.log(`        - ${record.content} (ID: ${record.id})`);
								}
							}
						}

						console.log("\n💡 Consider manually cleaning up these duplicates in the INWX control panel.");
						console.log("   You can delete unwanted records using their IDs shown above.");
					} else {
						console.log("🎉 No problematic duplicates found!");
					}
				} else {
					console.error("❌ Error:", result.error);
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
