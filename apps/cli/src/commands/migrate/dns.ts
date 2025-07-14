import type { Argv } from "yargs";
import { migrateDnsRecords } from "../../actions/migrate/dns.ts";
import type { ConflictResolutionStrategy } from "../../types/migrate-dns.ts";
import { getInwxConnectionFromEnv, getMiabConnectionFromEnv, printEnvExample } from "../../utils/env.ts";

interface DnsOptions {
	// Migration options
	"dry-run"?: boolean;
	verbose?: boolean;
	environment?: "ote" | "live";
	"conflict-resolution"?: ConflictResolutionStrategy;
	include?: string[];
	exclude?: string[];
}

export function dnsCommand(yargs: Argv): void {
	yargs.command({
		command: "dns",
		describe: "Migrate DNS records from MIAB to INWX (credentials from .env file)",
		builder: (yargs: Argv) => {
			return yargs
				.group(["dry-run", "verbose", "environment"], "Migration Options:")
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
				.option("environment", {
					type: "string",
					choices: ["ote", "live"] as const,
					description: "INWX environment to use",
					default: "ote",
				})
				.option("conflict-resolution", {
					type: "string",
					choices: ["skip", "overwrite", "interactive"] as const,
					description: "How to handle conflicting DNS records",
					default: "skip" as ConflictResolutionStrategy,
				})
				.option("include", {
					type: "array",
					description: "Glob patterns for domains to include (default: * for all domains)",
					default: ["*"],
					coerce: (arg: string[]) => arg.flatMap((item: string) => item.split(",").map((d: string) => d.trim())),
				})
				.option("exclude", {
					type: "array",
					description: "Glob patterns for domains to exclude from migration",
					coerce: (arg: string[]) => arg.flatMap((item: string) => item.split(",").map((d: string) => d.trim())),
				})
				.example("$0 migrate dns --dry-run", "Test DNS migration without making changes (OTE environment)")
				.example("$0 migrate dns --environment live", "Migrate DNS records to Live environment")
				.example("$0 migrate dns --environment ote", "Migrate DNS records to OTE environment")
				.example("$0 migrate dns --conflict-resolution=overwrite", "Overwrite conflicting records")
				.example("$0 migrate dns --conflict-resolution=interactive", "Ask for each conflicting record")
				.example("$0 migrate dns --verbose", "Migration with verbose output")
				.example("$0 migrate dns --include=*.de", "Migrate only .de domains")
				.example("$0 migrate dns --include=box.*.de", "Migrate only box.*.de domains")
				.example("$0 migrate dns --include=box.mailfreun.de", "Migrate only box.mailfreun.de domain")
				.example("$0 migrate dns --exclude=example.com,test.org", "Exclude specific domains from migration");
		},
		handler: async (args: unknown) => {
			const options = args as DnsOptions;

			console.log("🚀 Starting DNS migration from MIAB to INWX...");

			try {
				const miabConnection = getMiabConnectionFromEnv(options.verbose || false);
				const inwxConnection = getInwxConnectionFromEnv(options.environment || "ote", options.verbose || false);

				// Show mode-specific messaging
				if (options["dry-run"]) {
					console.log("🔍 DRY RUN MODE: No actual changes will be made\n");
				} else {
					const isOte = (options.environment || "ote") === "ote";
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

				// Show included/excluded domains
				const included = options.include || ["*"];
				const excluded = options.exclude || [];
				console.log(`📦 Included Domains (glob): ${included.join(", ")}`);
				if (excluded.length > 0) {
					console.log(`🚫 Excluded Domains (glob): ${excluded.join(", ")}`);
					console.log("   These domains will be skipped during migration");
				}

				console.log("\n🔧 Initializing connections...");
				console.log(`   MIAB Server: ${miabConnection.apiUrl}`);
				console.log(`   INWX Environment: ${inwxConnection.environment.toUpperCase()}`);
				console.log("");

				// Perform migration
				const result = await migrateDnsRecords({
					miab: miabConnection,
					inwx: inwxConnection,
					dryRun: options["dry-run"],
					conflictResolution: options["conflict-resolution"],
					include: options.include,
					exclude: options.exclude,
				});

				if (result.success) {
					console.log(`🎉 ${result.message}`);
					if (result.data && options.verbose) {
						console.log("\n📊 Migration Summary:");
						console.log(`   Total Zones: ${result.data.migration.totalZones}`);
						console.log(`   Processed Zones: ${result.data.migration.processedZones}`);
						console.log(`   Successful Zones: ${result.data.migration.successfulZones}`);
						console.log(`   Failed Zones: ${result.data.migration.failedZones}`);
						console.log(`   Timestamp: ${result.data.migration.timestamp}`);
					}
				} else {
					console.error(`❌ Migration failed: ${result.error}`);
					console.log("\n💡 Use --verbose for detailed error information");
					process.exit(1);
				}
			} catch (error) {
				console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
				console.log("\n💡 Make sure you have a .env file with the required credentials:");
				printEnvExample();
				process.exit(1);
			}
		},
	});
}
