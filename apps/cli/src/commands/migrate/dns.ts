import type { Argv } from "yargs";
import { migrateDnsRecords } from "../../actions/migrate/dns.ts";
import type { ConflictResolutionStrategy } from "../../types/migrate-dns.ts";
import { getInwxConnectionFromEnv, getMiabConnectionFromEnv, printEnvExample } from "../../utils/env.ts";

interface DnsOptions {
	// Migration options
	"dry-run"?: boolean;
	verbose?: boolean;
	"conflict-resolution"?: ConflictResolutionStrategy;
	"exclude-domains"?: string[];
}

export function dnsCommand(yargs: Argv): void {
	yargs.command({
		command: "dns",
		describe: "Migrate DNS records from MIAB to INWX (credentials from .env file)",
		builder: (yargs: Argv) => {
			return yargs
				.group(["dry-run", "verbose"], "Migration Options:")
				.group(["conflict-resolution"], "Conflict Resolution:")
				.option("dry-run", {
					type: "boolean",
					description: "Show what would be done without making changes",
					default: false,
				})
				.option("verbose", {
					type: "boolean",
					description: "Enable verbose output",
					default: false,
				})
				.option("conflict-resolution", {
					type: "string",
					choices: ["skip", "overwrite", "interactive"] as const,
					description: "How to handle conflicting DNS records",
					default: "skip" as ConflictResolutionStrategy,
				})
				.option("exclude-domains", {
					type: "array",
					description: "Comma-separated list of domains to exclude from migration",
					coerce: (arg: string[]) => arg.flatMap((item: string) => item.split(",").map((d: string) => d.trim())),
				})
				.example("$0 migrate dns --dry-run", "Test DNS migration without making changes")
				.example("$0 migrate dns", "Migrate DNS records from MIAB to INWX")
				.example("$0 migrate dns --conflict-resolution=overwrite", "Overwrite conflicting records")
				.example("$0 migrate dns --conflict-resolution=interactive", "Ask for each conflicting record")
				.example("$0 migrate dns --verbose", "Migration with verbose output")
				.example("$0 migrate dns --exclude-domains=example.com,test.org", "Exclude specific domains from migration");
		},
		handler: async (args: unknown) => {
			const options = args as DnsOptions;

			console.log("🚀 Starting DNS migration from MIAB to INWX...");

			try {
				const miabConnection = getMiabConnectionFromEnv();
				const inwxConnection = getInwxConnectionFromEnv();

				// Show mode-specific messaging
				if (options["dry-run"]) {
					console.log("🔍 DRY RUN MODE: No actual changes will be made\n");
				} else {
					const isOte = (inwxConnection.environment || "ote") === "ote";
					if (isOte) {
						console.log("⚠️  LIVE MIGRATION MODE: Changes will be made to INWX DNS records (TEST ENVIRONMENT)\n");
					} else {
						console.log("🚨 LIVE MIGRATION MODE: Changes will be made to INWX DNS records (PRODUCTION ENVIRONMENT)\n");
					}
				}

				// Show conflict resolution strategy
				const conflictStrategy = options["conflict-resolution"] || "skip";
				console.log(`🔧 Conflict Resolution Strategy: ${conflictStrategy.toUpperCase()}`);
				switch (conflictStrategy) {
					case "skip":
						console.log("   Conflicting records will be skipped (existing INWX records preserved)");
						break;
					case "overwrite":
						console.log("   Conflicting records will be overwritten with MIAB values");
						break;
					case "interactive":
						console.log("   You will be prompted for each conflicting record");
						break;
				}

				// Show excluded domains
				const excludedDomains = options["exclude-domains"] || [];
				if (excludedDomains.length > 0) {
					console.log(`🚫 Excluded Domains: ${excludedDomains.join(", ")}`);
					console.log("   These domains will be skipped during migration");
				}

				console.log("\n🔧 Initializing connections...");
				console.log(`   MIAB Server: ${miabConnection.apiUrl}`);
				console.log(`   INWX Environment: ${inwxConnection.environment.toUpperCase()}`);
				console.log("");

				const result = await migrateDnsRecords({
					miab: {
						...miabConnection,
						verbose: options.verbose,
					},
					inwx: {
						...inwxConnection,
						verbose: options.verbose,
					},
					dryRun: options["dry-run"],
					conflictResolution: conflictStrategy,
					excludeDomains: options["exclude-domains"],
				});

				if (result.success) {
					console.log(`✅ ${result.message}`);

					if (result.data) {
						const { migration } = result.data;

						console.log(`📊 Final Migration Summary:`);
						console.log(`   Total Zones: ${migration.totalZones}`);
						console.log(`   Processed Zones: ${migration.processedZones}`);
						console.log(`   Successful Zones: ${migration.successfulZones}`);
						console.log(`   Failed Zones: ${migration.failedZones}`);

						const totalRecords = migration.results.reduce((sum, result) => sum + result.totalRecords, 0);
						const successfulRecords = migration.results.reduce((sum, result) => sum + result.successfulRecords, 0);
						const failedRecords = migration.results.reduce((sum, result) => sum + result.failedRecords, 0);
						const skippedRecords = migration.results.reduce((sum, result) => sum + result.skippedRecords, 0);
						const updatedRecords = migration.results.reduce((sum, result) => sum + result.updatedRecords, 0);

						console.log(`   Total Records: ${totalRecords}`);
						console.log(`   Successful Records: ${successfulRecords}`);
						console.log(`   Failed Records: ${failedRecords}`);
						console.log(`   Skipped Records: ${skippedRecords}`);
						console.log(`   Updated Records: ${updatedRecords}`);

						const successRate = totalRecords > 0 ? Math.round((successfulRecords / totalRecords) * 100) : 0;
						console.log(`   Overall Success Rate: ${successRate}%`);

						// Show warnings summary
						const totalWarnings = migration.results.reduce((sum, result) => sum + result.warnings.length, 0);
						if (totalWarnings > 0) {
							console.log(`\n⚠️  Warnings: ${totalWarnings}`);
							const domainWarnings = migration.results.filter((result) =>
								result.warnings.some((warning) => warning.includes("not registered")),
							);
							if (domainWarnings.length > 0) {
								console.log(`   ${domainWarnings.length} domains are not registered in your INWX account`);
								console.log(`   💡 Only domains registered in your INWX account can have DNS zones created`);
							}
						}

						if (migration.dryRun) {
							console.log("\n💡 This was a dry run. Remove --dry-run to actually migrate the records.");
						} else {
							const isOte = (inwxConnection.environment || "ote") === "ote";
							if (isOte) {
								console.log("\n🎉 Migration completed successfully in TEST environment!");
							} else {
								console.log("\n🎉 Migration completed successfully in PRODUCTION environment!");
							}
						}

						// Show detailed results if verbose or if there were errors
						if (options.verbose || failedRecords > 0) {
							console.log("\n📋 Detailed Zone Results:");
							for (const zoneResult of migration.results.slice(0, 10)) {
								// Limit to first 10 zones in summary
								const status = zoneResult.failedRecords === 0 ? "✅" : "❌";
								console.log(
									`   ${status} ${zoneResult.zone}: ${zoneResult.successfulRecords}/${zoneResult.totalRecords} records`,
								);

								if (zoneResult.warnings.length > 0) {
									console.log(`      ⚠️  ${zoneResult.warnings.slice(0, 2).join(", ")}`);
								}

								if (zoneResult.errors.length > 0 && !options.verbose) {
									console.log(`      First error: ${zoneResult.errors[0]}`);
								}
							}

							if (migration.results.length > 10) {
								console.log(`   ... and ${migration.results.length - 10} more zones`);
							}
						}

						// Show zones that needed creation
						const zonesWithWarnings = migration.results.filter((r) => r.warnings.length > 0);
						if (zonesWithWarnings.length > 0) {
							console.log("\n🔧 DNS Zone Creation Summary:");
							for (const zoneResult of zonesWithWarnings) {
								const creationWarning = zoneResult.warnings.find(
									(w) => w.includes("would be created") || w.includes("was created"),
								);
								if (creationWarning) {
									console.log(`   📝 ${zoneResult.zone}: ${creationWarning}`);
								}
							}
						}

						// Show only failed zones if there are failures and not in verbose mode
						if (failedRecords > 0 && !options.verbose) {
							const failedZones = migration.results.filter((r) => r.failedRecords > 0);
							if (failedZones.length > 0) {
								console.log("\n❌ Zones with Failures:");
								for (const zoneResult of failedZones.slice(0, 5)) {
									console.log(`   ${zoneResult.zone}: ${zoneResult.failedRecords} failed records`);
									for (const error of zoneResult.errors.slice(0, 2)) {
										console.log(`      - ${error}`);
									}
									if (zoneResult.errors.length > 2) {
										console.log(`      ... and ${zoneResult.errors.length - 2} more errors`);
									}
								}
								if (failedZones.length > 5) {
									console.log(`   ... and ${failedZones.length - 5} more failed zones`);
								}
								console.log("\n💡 Use --verbose for detailed error information");
							}
						}

						if (options.verbose) {
							console.log("\n🔧 Connection Details:");
							console.log(`   MIAB URL: ${result.data.miab.baseUrl}`);
							console.log(`   MIAB Username: ${result.data.miab.username}`);
							console.log(`   MIAB Zones Found: ${result.data.miab.zones.length}`);
							console.log(`   INWX Username: ${result.data.inwx.username}`);
							console.log(`   INWX Environment: ${result.data.inwx.environment.toUpperCase()}`);
							console.log(`   INWX API URL: ${result.data.inwx.apiUrl}`);
							console.log(`   Migration Started: ${migration.timestamp}`);
						}
					}
				} else {
					console.error(`❌ ${result.error}`);
					process.exit(1);
				}
			} catch (error) {
				console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
				console.log("\n💡 Make sure you have a .env file with the required MIAB and INWX credentials:");
				printEnvExample();
				process.exit(1);
			}
		},
	});
}
