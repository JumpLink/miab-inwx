import { MiabClient } from "@miab-inwx/miab-client";
import { ApiClient, Language } from "domrobot-client";
import type { CommandResult } from "../types/index.ts";
import type { DnsRecord, DnsZone, ExistingInwxRecord } from "../types/migrate-dns.ts";
import type { 
	MiabConnectionConfig, 
	InwxConnectionConfig, 
	InwxEnvironmentInfo
} from "../types/dns.ts";
import {
	INWX_SUCCESS_CODE,
	INWX_ZONE_NOT_FOUND_CODE,
	INWX_RECORD_EXISTS_CODE,
	INWX_POLICY_VIOLATION_CODE
} from "./constants.ts";
import { 
	findMatchingRecord, 
	getDomainName, 
	convertRawRecordToDnsRecord, 
	convertInwxRecordToDnsRecord 
} from "./dns-helpers.ts";
import { parseMxRecord, parseSrvRecord, cleanSshfpRecord } from "./record-parsers.ts";
import { compareRecords } from "./record-comparers.ts";

// Re-export constants for backward compatibility
export { 
	INWX_SUCCESS_CODE,
	INWX_ZONE_NOT_FOUND_CODE, 
	INWX_RECORD_EXISTS_CODE,
	INWX_POLICY_VIOLATION_CODE
} from "./constants.ts";

// Re-export comparison function for backward compatibility
export { compareRecords } from "./record-comparers.ts";

/**
 * Handle API errors during record fetching
 */
function handleRecordFetchError(error: unknown, domain: string): CommandResult<ExistingInwxRecord | null> {
	const errorMessage = error instanceof Error ? error.message : "Unknown API error";

	if (errorMessage.includes("Unexpected end of JSON input") || errorMessage.includes("JSON")) {
		return {
			success: false,
			error: `INWX API returned invalid JSON when fetching records for ${domain}. This might be a temporary API issue.`,
		};
	}

	throw error;
}

/**
 * Find existing INWX record that matches the MIAB record
 */
export async function findExistingInwxRecord(
	client: ApiClient,
	domain: string,
	miabRecord: DnsRecord,
): Promise<CommandResult<ExistingInwxRecord | null>> {
	try {
		let recordsResponse: { code: number; msg: string; resData?: { record?: any[] } };
		
		try {
			recordsResponse = await client.callApi("nameserver.info", { domain });
		} catch (apiError) {
			return handleRecordFetchError(apiError, domain);
		}

		if (recordsResponse.code !== INWX_SUCCESS_CODE) {
			if (recordsResponse.code === INWX_ZONE_NOT_FOUND_CODE) {
				return { success: true, data: null };
			}
			return {
				success: false,
				error: `Failed to fetch records for ${domain} (Code: ${recordsResponse.code}): ${recordsResponse.msg}`,
			};
		}

		const records = recordsResponse.resData?.record || [];
		const matchingRecord = findMatchingRecord(records, miabRecord);

		return { success: true, data: matchingRecord };
	} catch (error) {
		return {
			success: false,
			error: `Error finding existing record: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}

/**
 * Build update parameters for different record types
 */
function buildUpdateParameters(miabRecord: DnsRecord): Record<string, unknown> {
	const updateParams: Record<string, unknown> = {};

	switch (miabRecord.rtype) {
		case "MX": {
			const { prio, content } = parseMxRecord(miabRecord.value);
			updateParams.prio = prio;
			updateParams.content = content;
			break;
		}
		case "SRV": {
			const { prio, weight, port, content } = parseSrvRecord(miabRecord.value);
			updateParams.prio = prio;
			updateParams.weight = weight;
			updateParams.port = port;
			updateParams.content = content;
			break;
		}
		case "SSHFP": {
			updateParams.content = cleanSshfpRecord(miabRecord.value);
			break;
		}
		default: {
			updateParams.content = miabRecord.value;
			break;
		}
	}

	return updateParams;
}

/**
 * Update an existing INWX DNS record
 */
export async function updateInwxRecord(
	client: ApiClient,
	_domain: string,
	recordId: string,
	miabRecord: DnsRecord,
): Promise<CommandResult<void>> {
	try {
		const updateParams = {
			id: recordId,
			...buildUpdateParameters(miabRecord),
		};

		const updateResponse = await client.callApi("nameserver.updateRecord", updateParams);

		if (updateResponse.code !== INWX_SUCCESS_CODE) {
			return {
				success: false,
				error: `Failed to update record (Code: ${updateResponse.code}): ${updateResponse.msg}`,
			};
		}

		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: `Error updating record: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}

/**
 * Test MIAB API connection and fetch DNS zones
 */
export async function testMiabConnection(
	apiUrl: string,
	auth: string,
	verbose?: boolean,
): Promise<CommandResult<string[]>> {
	try {
		const response = await MiabClient.getDnsZones({
			baseUrl: apiUrl,
			auth,
			throwOnError: true,
		});

		if (!response.data || !Array.isArray(response.data)) {
			return { success: false, error: "Invalid response from MIAB API when fetching DNS zones" };
		}

		if (verbose) {
			console.log(`Found ${response.data.length} DNS zones in MIAB`);
		}

		return { success: true, data: response.data };
	} catch (error) {
		return {
			success: false,
			error: `Failed to connect to MIAB API: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}

/**
 * Test INWX API connection
 */
export async function testInwxConnection(
	client: ApiClient,
	config: InwxConnectionConfig,
): Promise<CommandResult<void>> {
	try {
		const response = await client.login(config.username, config.password, config.sharedSecret);

		if (response.code !== INWX_SUCCESS_CODE) {
			return { success: false, error: `INWX authentication failed (Code: ${response.code}): ${response.msg}` };
		}

		if (config.verbose) {
			console.log("Successfully authenticated with INWX API");
		}

		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: `Failed to connect to INWX API: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}

/**
 * Fetch and parse DNS zones from MIAB
 */
export async function fetchMiabDnsZones(config: MiabConnectionConfig): Promise<CommandResult<DnsZone[]>> {
	try {
		const response = await MiabClient.getDnsDump({
			baseUrl: config.baseUrl,
			auth: config.auth,
			throwOnError: true,
		});

		if (!response.data || !Array.isArray(response.data)) {
			return { success: false, error: "Invalid response from MIAB API when fetching DNS dump" };
		}

		const dnsZones = parseMiabDnsDump(response.data);

		if (config.verbose) {
			const totalRecords = dnsZones.reduce((sum, zone) => sum + zone.records.length, 0);
			console.log(`Parsed ${dnsZones.length} DNS zones with ${totalRecords} total records`);
		}

		return { success: true, data: dnsZones };
	} catch (error) {
		return {
			success: false,
			error: `Failed to fetch DNS records from MIAB: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}

/**
 * Fetch DNS zones from INWX
 */
export async function fetchInwxDnsZones(client: ApiClient, verbose?: boolean): Promise<CommandResult<DnsZone[]>> {
	try {
		const nameserverListResponse = await client.callApi("nameserver.list", {});

		if (nameserverListResponse.code !== INWX_SUCCESS_CODE) {
			return {
				success: false,
				error: `Failed to list DNS zones (Code: ${nameserverListResponse.code}): ${nameserverListResponse.msg}`,
			};
		}

		const domains = nameserverListResponse.resData?.domains || [];
		const zones: DnsZone[] = [];

		if (verbose) {
			console.log(`Found ${domains.length} DNS zones in INWX`);
		}

		for (const domainInfo of domains) {
			const domain = getDomainName(domainInfo);
			if (!domain) continue;

			if (verbose) {
				console.log(`Fetching records for zone: ${domain}`);
			}

			const recordsResult = await fetchInwxZoneRecords(client, domain);
			if (recordsResult.success && recordsResult.data) {
				zones.push({
					domain,
					records: recordsResult.data,
				});
			} else if (verbose) {
				console.warn(`Failed to fetch records for ${domain}: ${recordsResult.error}`);
			}
		}

		const totalRecords = zones.reduce((sum, zone) => sum + zone.records.length, 0);

		if (verbose) {
			console.log(`Successfully fetched ${zones.length} zones with ${totalRecords} total records`);
		}

		return { success: true, data: zones };
	} catch (error) {
		return {
			success: false,
			error: `Failed to fetch DNS zones from INWX: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}

/**
 * Fetch DNS records for a specific zone from INWX
 */
export async function fetchInwxZoneRecords(client: ApiClient, domain: string): Promise<CommandResult<DnsRecord[]>> {
	try {
		const recordsResponse = await client.callApi("nameserver.info", { domain });

		if (recordsResponse.code !== INWX_SUCCESS_CODE) {
			return {
				success: false,
				error: `Failed to fetch records for ${domain} (Code: ${recordsResponse.code}): ${recordsResponse.msg}`,
			};
		}

		const records: DnsRecord[] = [];
		const recordsData = recordsResponse.resData?.record || [];

		for (const record of recordsData) {
			if (record && typeof record === "object") {
				records.push(convertInwxRecordToDnsRecord(record));
			}
		}

		return { success: true, data: records };
	} catch (error) {
		return {
			success: false,
			error: `Failed to fetch records for ${domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}

/**
 * Parse MIAB DNS dump into structured zones
 */
export function parseMiabDnsDump(dumpData: unknown[]): DnsZone[] {
	const zones: Map<string, DnsRecord[]> = new Map();

	for (const item of dumpData) {
		if (!Array.isArray(item) || item.length < 2) continue;

		const domain = item[0];
		const records = item[1];

		if (typeof domain !== "string" || !Array.isArray(records)) continue;

		const dnsRecords: DnsRecord[] = [];
		for (const record of records) {
			const dnsRecord = convertRawRecordToDnsRecord(record);
			if (dnsRecord) {
				dnsRecords.push(dnsRecord);
			}
		}

		zones.set(domain, dnsRecords);
	}

	return Array.from(zones.entries()).map(([domain, records]) => ({
		domain,
		records,
	}));
}

/**
 * Get environment information for INWX API
 */
function getInwxEnvironmentInfo(environment: string): InwxEnvironmentInfo {
	const isOte = environment === "ote";
	return {
		name: isOte ? "OTE (Test)" : "Live (Production)",
		apiUrl: isOte ? ApiClient.API_URL_OTE : ApiClient.API_URL_LIVE,
		isOte,
	};
}

/**
 * Initialize INWX API client with environment info
 */
export function createInwxClient(config: InwxConnectionConfig): {
	client: ApiClient;
	environmentInfo: InwxEnvironmentInfo;
} {
	const environmentInfo = getInwxEnvironmentInfo(config.environment || "ote");
	const client = new ApiClient(environmentInfo.apiUrl, Language.EN, config.verbose);

	return {
		client,
		environmentInfo,
	};
}

/**
 * Cleanup INWX API client
 */
export async function cleanupInwxClient(client: ApiClient): Promise<void> {
	try {
		await client.logout();
	} catch (_error) {
		// Ignore logout errors
	}
}
