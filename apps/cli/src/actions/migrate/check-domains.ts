import { minimatch } from "minimatch";
import type { CommandResult } from "../../types/index.ts";
import type { MigrateCheckData, MigrateCheckOptions } from "../../types/migrate-check.ts";
import { cleanupInwxClient, createInwxClient, testInwxConnection, testMiabConnection } from "../../utils/dns.ts";
import { getDomainName } from "../../utils/dns-helpers.ts";
import { INWX_SUCCESS_CODE } from "../../utils/constants.ts";

/**
 * Check which MIAB domains exist as DNS zones in INWX (nameserver.list)
 */
export async function checkMiabDomainsPresence(options: MigrateCheckOptions): Promise<CommandResult<MigrateCheckData>> {
	try {
		const { miab, inwx, include = ["*"], exclude = [], verbose } = options;

		// Validate MIAB connection
		if (!miab.apiUrl || !miab.email || !miab.password) {
			return { success: false, error: "Missing required MIAB connection parameters: apiUrl, email, password" };
		}

		// Validate INWX connection
		if (!inwx.username || !inwx.password) {
			return { success: false, error: "Missing required INWX connection parameters: username, password" };
		}

		const miabAuth = `${miab.email}:${miab.password}`;

		if (verbose) {
			console.log("Fetching MIAB domains (zones)...");
		}

		// Get MIAB zones via lightweight connection test endpoint
		const miabZonesResult = await testMiabConnection(miab.apiUrl, miabAuth, verbose);
		if (!miabZonesResult.success || !miabZonesResult.data) {
			return { success: false, error: miabZonesResult.error || "Failed to fetch MIAB domains" };
		}

		// Apply include/exclude filters to MIAB domains
		const filteredMiabDomains = miabZonesResult.data.filter((domain) => {
			const isIncluded = include.some((pattern) => minimatch(domain, pattern));
			const isExcluded = exclude.some((pattern) => minimatch(domain, pattern));
			return isIncluded && !isExcluded;
		});

		if (verbose) {
			console.log(`Considering ${filteredMiabDomains.length} MIAB domains after filters`);
		}

		// Initialize INWX client and authenticate
		const { client, environmentInfo } = createInwxClient({
			username: inwx.username,
			password: inwx.password,
			sharedSecret: inwx.sharedSecret,
			environment: inwx.environment || "ote",
			verbose,
		});

		const inwxAuth = await testInwxConnection(client, {
			username: inwx.username,
			password: inwx.password,
			sharedSecret: inwx.sharedSecret,
			environment: inwx.environment || "ote",
			verbose,
		});
		if (!inwxAuth.success) {
			await cleanupInwxClient(client);
			return { success: false, error: inwxAuth.error };
		}

		if (verbose) {
			console.log("Fetching INWX DNS zones (nameserver.list)...");
		}


		const nameserverListResponse = await client.callApi("nameserver.list", {});
		const inwxDomainsRaw = Array.isArray(nameserverListResponse?.resData?.domains)
			? nameserverListResponse.resData.domains
			: [];
		const inwxZones = inwxDomainsRaw
			.map((d: unknown) => getDomainName(d))
			.filter((d: string | null): d is string => Boolean(d));

		const inwxZonesSet = new Set(inwxZones);

		// Fetch nameservers for domains that exist in INWX
		const domainsPresence = [] as Array<{
			domain: string;
			existsInInwx: boolean;
			nameservers?: string[];
			nameserverCategory?: "jumplink" | "box" | "inwx" | "other" | "none";
		}>;

		for (const domain of filteredMiabDomains) {
			if (!inwxZonesSet.has(domain)) {
				domainsPresence.push({ domain, existsInInwx: false, nameserverCategory: "none" });
				continue;
			}

			const info = await client.callApi("domain.info", { domain });
			let nameservers: string[] | undefined;
			if (info && info.code === INWX_SUCCESS_CODE) {
				const ns = info.resData?.ns;
				if (Array.isArray(ns)) {
					nameservers = ns.map((n: unknown) => String((n as { name?: string })?.name || n)).filter(Boolean);
				}
			}

			const category = categorizeNameservers(nameservers);
			domainsPresence.push({ domain, existsInInwx: true, nameservers, nameserverCategory: category });
		}

		const presentInInwx = domainsPresence.filter((d) => d.existsInInwx).length;
		const missingInInwx = domainsPresence.length - presentInInwx;
		const categoriesCount = {
			jumplink: domainsPresence.filter((d) => d.nameserverCategory === "jumplink").length,
			box: domainsPresence.filter((d) => d.nameserverCategory === "box").length,
			inwx: domainsPresence.filter((d) => d.nameserverCategory === "inwx").length,
			other: domainsPresence.filter((d) => d.nameserverCategory === "other").length,
			none: domainsPresence.filter((d) => d.nameserverCategory === "none").length,
		};

		await cleanupInwxClient(client);

		return {
			success: true,
			message: `Checked ${filteredMiabDomains.length} MIAB domains against INWX zones: ${presentInInwx} present, ${missingInInwx} missing`,
			data: {
				miab: {
					baseUrl: miab.apiUrl,
					username: miab.email,
					authenticated: true,
					totalDomains: miabZonesResult.data.length,
				},
				inwx: {
					username: inwx.username,
					environment: environmentInfo.isOte ? "ote" : "live",
					apiUrl: environmentInfo.apiUrl,
					authenticated: true,
					totalZones: inwxZones.length,
				},
				summary: {
					totalMiabDomains: filteredMiabDomains.length,
					presentInInwx,
					missingInInwx,
					timestamp: new Date().toISOString(),
					categories: categoriesCount,
				},
				domains: domainsPresence,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to check MIAB domains presence in INWX",
		};
	}
}

function categorizeNameservers(nameservers?: string[]): "jumplink" | "box" | "inwx" | "other" | "none" {
	if (!nameservers || nameservers.length === 0) return "none";
	const lower = nameservers.map((n) => n.toLowerCase());
	if (lower.some((n) => n.includes("jumplink.me"))) return "jumplink";
	if (lower.some((n) => n.includes("box.mailfreun.de") || n.includes("mailfreun.de"))) return "box";
	if (lower.some((n) => n.includes("inwx.de") || n.includes("inwx.com") || n.includes("inwx.net"))) return "inwx";
	return "other";
}


