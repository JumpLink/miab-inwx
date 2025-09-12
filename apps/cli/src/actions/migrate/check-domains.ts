import type { ApiClient } from "domrobot-client";
import { minimatch } from "minimatch";
import type { CommandResult } from "../../types/index.ts";
import type { MigrateCheckData, MigrateCheckOptions } from "../../types/migrate-check.ts";
import { INWX_SUCCESS_CODE } from "../../utils/constants.ts";
import { cleanupInwxClient, createInwxClient, testInwxConnection, testMiabConnection } from "../../utils/dns.ts";
import { getDomainName } from "../../utils/dns-helpers.ts";
import { getAllDomains } from "../../utils/inwx-helpers.ts";
import { categorizeNameservers } from "../../utils/nameservers.ts";

// Internal types
interface PresenceEntry {
	domain: string;
	existsInInwx: boolean;
	nameservers?: string[];
	nameserverCategory?: "jumplink" | "box" | "inwx" | "other" | "none";
}

/**
 * Check which MIAB domains exist in INWX (registered or DNS zone present) and their nameservers
 */
export async function checkMiabDomainsPresence(options: MigrateCheckOptions): Promise<CommandResult<MigrateCheckData>> {
	try {
		const { miab, inwx, include = ["*"], exclude = [], verbose } = options;

		const validateMiab = validateMiabOptions(miab);
		if (validateMiab) return validateMiab;
		const validateInwx = validateInwxOptions(inwx);
		if (validateInwx) return validateInwx;

		const miabAuth = `${miab.email as string}:${miab.password as string}`;
		if (verbose) console.log("Fetching MIAB domains (zones)...");
		const miabZonesResult = await testMiabConnection(miab.apiUrl as string, miabAuth, verbose);
		if (!miabZonesResult.success || !miabZonesResult.data) {
			return { success: false, error: miabZonesResult.error || "Failed to fetch MIAB domains" };
		}

		const filteredMiabDomains = filterDomains(miabZonesResult.data, include, exclude);
		if (verbose) console.log(`Considering ${filteredMiabDomains.length} MIAB domains after filters`);

		const { client, environmentInfo } = createInwxClient({
			username: inwx.username as string,
			password: inwx.password as string,
			sharedSecret: inwx.sharedSecret,
			environment: inwx.environment || "ote",
			verbose,
		});

		const inwxAuth = await testInwxConnection(client, {
			username: inwx.username as string,
			password: inwx.password as string,
			sharedSecret: inwx.sharedSecret,
			environment: inwx.environment || "ote",
			verbose,
		});
		if (!inwxAuth.success) {
			await cleanupInwxClient(client);
			return { success: false, error: inwxAuth.error };
		}

		if (verbose) console.log("Fetching INWX registered domains (domain.list)...");
		const registeredResult = await getAllDomains(client);
		if (!registeredResult.success || !registeredResult.domains) {
			await cleanupInwxClient(client);
			return { success: false, error: registeredResult.error || "Failed to fetch INWX registered domains" };
		}
		const registeredDomainsSet = new Set(registeredResult.domains);

		const inwxZones = await fetchInwxZones(client);
		const inwxZonesSet = new Set(inwxZones);

		const domainsPresence: PresenceEntry[] = [];
		for (const domain of filteredMiabDomains) {
			const isPresent = registeredDomainsSet.has(domain) || inwxZonesSet.has(domain);
			if (!isPresent) {
				domainsPresence.push({ domain, existsInInwx: false, nameserverCategory: "none" });
				continue;
			}

			const nameservers = await fetchNameservers(client, domain);
			const category = categorizeNameservers(nameservers);
			domainsPresence.push({ domain, existsInInwx: true, nameservers, nameserverCategory: category });
		}

		const presentInInwx = domainsPresence.filter((d) => d.existsInInwx).length;
		const missingInInwx = domainsPresence.length - presentInInwx;
		// INWX-only: domains in INWX (registered or zone) but not listed in MIAB
		const inwxUniverse = new Set<string>([...registeredDomainsSet, ...inwxZones]);
		const miabSet = new Set(filteredMiabDomains);
		const inwxOnlyList: PresenceEntry[] = [];
		for (const d of inwxUniverse) {
			if (!miabSet.has(d)) {
				const nameservers = await fetchNameservers(client, d);
				inwxOnlyList.push({
					domain: d,
					existsInInwx: true,
					nameservers,
					nameserverCategory: categorizeNameservers(nameservers),
				});
			}
		}
		const categoriesCount = summarizeCategories(domainsPresence);

		await cleanupInwxClient(client);

		return {
			success: true,
			message: `Checked ${filteredMiabDomains.length} MIAB domains against INWX zones: ${presentInInwx} present, ${missingInInwx} missing`,
			data: {
				miab: {
					baseUrl: miab.apiUrl as string,
					username: miab.email as string,
					authenticated: true,
					totalDomains: miabZonesResult.data.length,
				},
				inwx: {
					username: inwx.username as string,
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
					inwxOnly: inwxOnlyList.length,
				},
				domains: domainsPresence,
				inwxOnly: inwxOnlyList.sort((a, b) => a.domain.localeCompare(b.domain)),
			},
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to check MIAB domains presence in INWX",
		};
	}
}

// Helpers
function validateMiabOptions(miab: {
	apiUrl?: string;
	email?: string;
	password?: string;
}): CommandResult<never> | null {
	if (!miab.apiUrl || !miab.email || !miab.password) {
		return { success: false, error: "Missing required MIAB connection parameters: apiUrl, email, password" };
	}
	return null;
}

function validateInwxOptions(inwx: { username?: string; password?: string }): CommandResult<never> | null {
	if (!inwx.username || !inwx.password) {
		return { success: false, error: "Missing required INWX connection parameters: username, password" };
	}
	return null;
}

function filterDomains(domains: string[], include: string[], exclude: string[]): string[] {
	const includePatterns = include && include.length > 0 ? include : ["*"];
	const excludePatterns = exclude || [];
	return domains.filter(
		(d) => includePatterns.some((p) => minimatch(d, p)) && !excludePatterns.some((p) => minimatch(d, p)),
	);
}

async function fetchInwxZones(client: ApiClient): Promise<string[]> {
	try {
		const nameserverListResponse = await client.callApi("nameserver.list", {});
		const raw = Array.isArray(nameserverListResponse?.resData?.domains) ? nameserverListResponse.resData.domains : [];
		return raw.map((d: unknown) => getDomainName(d)).filter((d: string | null): d is string => Boolean(d));
	} catch {
		return [];
	}
}

async function fetchNameservers(client: ApiClient, domain: string): Promise<string[] | undefined> {
	const info = await client.callApi("domain.info", { domain });
	if (info && info.code === INWX_SUCCESS_CODE) {
		const ns = info.resData?.ns;
		if (Array.isArray(ns)) {
			return ns.map((n: unknown) => String((n as { name?: string })?.name || n)).filter(Boolean);
		}
	}
	return undefined;
}

function summarizeCategories(entries: PresenceEntry[]) {
	return {
		jumplink: entries.filter((d) => d.nameserverCategory === "jumplink").length,
		box: entries.filter((d) => d.nameserverCategory === "box").length,
		inwx: entries.filter((d) => d.nameserverCategory === "inwx").length,
		other: entries.filter((d) => d.nameserverCategory === "other").length,
		none: entries.filter((d) => d.nameserverCategory === "none").length,
	};
}
