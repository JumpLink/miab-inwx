import type { Argv } from "yargs";
import { checkMiabDomainsPresence } from "../../actions/migrate/check-domains.ts";
import { getInwxConnectionFromEnv, getMiabConnectionFromEnv, printEnvExample } from "../../utils/env.ts";

interface CheckOptions {
	verbose?: boolean;
	environment?: "ote" | "live";
	include?: string[];
	exclude?: string[];
}

export function checkDomainsCommand(yargs: Argv): void {
	yargs.command({
		command: "check-domains",
		describe: "Check which MIAB domains exist as DNS zones in INWX (credentials from .env file)",
		builder: (yargs: Argv) => {
			return yargs
				.group(["verbose", "environment"], "Options:")
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
				.option("include", {
					type: "array",
					description: "Glob patterns for domains to include (default: * for all domains)",
					default: ["*"],
					coerce: (arg: string[]) => arg.flatMap((item: string) => item.split(",").map((d: string) => d.trim())),
				})
				.option("exclude", {
					type: "array",
					description: "Glob patterns for domains to exclude from the check",
					coerce: (arg: string[]) => arg.flatMap((item: string) => item.split(",").map((d: string) => d.trim())),
				})
				.example("$0 migrate check-domains", "Check which MIAB domains exist as INWX DNS zones")
				.example("$0 migrate check-domains --include=*.de", "Check only .de domains");
		},
		handler: async (args: unknown) => {
			const options = args as CheckOptions;
			try {
				const miabConnection = getMiabConnectionFromEnv(options.verbose || false);
				const inwxConnection = getInwxConnectionFromEnv(options.environment || "ote", options.verbose || false);

				console.log("🔍 Checking MIAB domains presence in INWX...");
				console.log(`   MIAB Server: ${miabConnection.apiUrl}`);
				console.log(`   INWX Environment: ${inwxConnection.environment.toUpperCase()}`);

				const result = await checkMiabDomainsPresence({
					miab: miabConnection,
					inwx: inwxConnection,
					include: options.include,
					exclude: options.exclude,
					verbose: options.verbose,
				});

				if (!result.success) {
					console.error(`❌ ${result.error}`);
					process.exit(1);
				}

				console.log(`\n${result.message}`);
				if (result.data) {
					const present = result.data.domains.filter((d) => d.existsInInwx);
					const missing = result.data.domains.filter((d) => !d.existsInInwx).map((d) => d.domain);

					console.log("\n📊 Summary:");
					console.log(
						`   Total MIAB domains considered: ${result.data.summary.totalMiabDomains} (present: ${result.data.summary.presentInInwx}, missing: ${result.data.summary.missingInInwx})`,
					);
					const c = result.data.summary.categories;
					console.log(
						`   Nameserver categories -> jumplink: ${c.jumplink}, box: ${c.box}, inwx: ${c.inwx}, other: ${c.other}, none: ${c.none}`,
					);
					console.log(`   INWX-only (not in MIAB): ${result.data.summary.inwxOnly}`);

					const groups: Record<string, { title: string; items: typeof present }> = {
						inwx: {
							title: "✅ Present in INWX (INWX nameservers)",
							items: present.filter((x) => x.nameserverCategory === "inwx"),
						},
						box: {
							title: "✅ Present in INWX (box.mailfreun.de nameservers)",
							items: present.filter((x) => x.nameserverCategory === "box"),
						},
						jumplink: {
							title: "✅ Present in INWX (jumplink.me nameservers)",
							items: present.filter((x) => x.nameserverCategory === "jumplink"),
						},
						other: {
							title: "✅ Present in INWX (other nameservers)",
							items: present.filter((x) => x.nameserverCategory === "other"),
						},
					};

					for (const key of Object.keys(groups)) {
						const group = groups[key as keyof typeof groups];
						if (group.items.length > 0) {
							console.log(`\n${group.title}:`);
							for (const entry of group.items.sort((a, b) => a.domain.localeCompare(b.domain))) {
								console.log(
									`   - ${entry.domain}${entry.nameservers?.length ? ` [NS: ${entry.nameservers.join(", ")}]` : ""}`,
								);
							}
						}
					}

					if (missing.length > 0) {
						console.log("\n❌ No DNS zone found in INWX (domain may be registered elsewhere):");
						for (const d of missing.sort()) console.log(`   - ${d}`);
					}

					if (result.data.inwxOnly?.length) {
						console.log("\nℹ️  Present in INWX but not in MIAB:");
						for (const entry of result.data.inwxOnly) {
							console.log(
								`   - ${entry.domain}${entry.nameservers?.length ? ` [NS: ${entry.nameservers.join(", ")}]` : ""}`,
							);
						}
					}
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
