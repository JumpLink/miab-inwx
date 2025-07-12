import type { Argv } from "yargs";
import { listMiabDns } from "../../actions/miab/list.ts";
import { getMiabConnectionFromEnv, printEnvExample } from "../../utils/env.ts";
import { formatDnsOutput } from "../../utils/formatters.ts";

interface ListOptions {
	verbose?: boolean;
	format?: "table" | "json" | "yaml";
	filter?: string;
	zone?: string;
}

export function listCommand(yargs: Argv): void {
	yargs.command({
		command: "list",
		describe: "List all DNS records from MIAB (credentials from .env file)",
		builder: (yargs: Argv) => {
			return yargs
				.option("verbose", {
					type: "boolean",
					description: "Enable verbose output",
					default: false,
				})
				.option("format", {
					type: "string",
					choices: ["table", "json", "yaml"],
					description: "Output format",
					default: "table",
				})
				.option("filter", {
					type: "string",
					description: "Filter records by text (searches in all fields)",
				})
				.option("zone", {
					type: "string",
					description: "Filter by specific zone/domain",
				})
				.example("$0 miab list", "List all DNS records in table format")
				.example("$0 miab list --format json", "List DNS records in JSON format")
				.example("$0 miab list --zone example.com", "List records for specific zone")
				.example("$0 miab list --filter mail", "Filter records containing 'mail'")
				.example("$0 miab list --verbose --format yaml", "Verbose output in YAML format");
		},
		handler: async (args: unknown) => {
			const listOptions = args as ListOptions;

			try {
				const connectionOptions = getMiabConnectionFromEnv();
				const result = await listMiabDns({
					...connectionOptions,
					verbose: listOptions.verbose,
					format: listOptions.format,
					filter: listOptions.filter,
					zone: listOptions.zone,
				});

				if (result.success) {
					console.log(`✅ ${result.message}`);

					if (result.data) {
						const { zones, totalZones, totalRecords } = result.data;

						// Show summary
						console.log(`\n📊 Summary:`);
						console.log(`  Total Zones: ${totalZones}`);
						console.log(`  Total Records: ${totalRecords}`);

						if (listOptions.filter) {
							console.log(`  Filter Applied: ${listOptions.filter}`);
						}

						if (listOptions.zone) {
							console.log(`  Zone Filter: ${listOptions.zone}`);
						}

						// Output formatted DNS data
						if (zones.length > 0) {
							console.log(`\n📋 DNS Records:`);

							if (listOptions.format === "json") {
								console.log(JSON.stringify(zones, null, 2));
							} else if (listOptions.format === "yaml") {
								console.log(formatDnsOutput(zones, "yaml"));
							} else {
								// Table format (default)
								for (const zone of zones) {
									console.log(`\n🌐 Zone: ${zone.domain} (${zone.records.length} records)`);
									console.log(formatDnsOutput([zone], "table"));
								}
							}
						} else {
							console.log(`\n⚠️ No DNS records found matching the criteria.`);
						}

						if (listOptions.verbose && result.data.connection) {
							console.log(`\n🔗 Connection Details:`);
							console.log(`  MIAB URL: ${result.data.connection.baseUrl}`);
							console.log(`  Username: ${result.data.connection.username}`);
							console.log(`  Environment: ${result.data.connection.environment}`);
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
