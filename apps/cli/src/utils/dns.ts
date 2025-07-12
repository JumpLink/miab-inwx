import { MiabClient } from "@miab-inwx/miab-client";
import { ApiClient, Language } from "domrobot-client";
import type { CommandResult } from "../types/index.ts";
import type { DnsRecord, DnsZone, ExistingInwxRecord, RecordComparison } from "../types/migrate-dns.ts";

// Constants for INWX API response codes
export const INWX_SUCCESS_CODE = 1000;
export const INWX_ZONE_NOT_FOUND_CODE = 2303;
export const INWX_RECORD_EXISTS_CODE = 2302;
export const INWX_POLICY_VIOLATION_CODE = 2308;

/**
 * Connection configuration for MIAB
 */
export interface MiabConnectionConfig {
	baseUrl: string;
	auth: string;
	verbose?: boolean;
}

/**
 * Connection configuration for INWX
 */
export interface InwxConnectionConfig {
	username: string;
	password: string;
	sharedSecret?: string;
	environment?: "ote" | "live";
	verbose?: boolean;
}

/**
 * Compare two DNS records to check if they are equal
 */
export function compareRecords(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): RecordComparison {
	const differences: string[] = [];

	// Normalize record names for comparison (remove trailing dots)
	const normalizedMiabName = miabRecord.qname.replace(/\.$/, "");
	const normalizedInwxName = inwxRecord.name.replace(/\.$/, "");

	// Compare record name
	if (normalizedMiabName !== normalizedInwxName) {
		differences.push(`Name: MIAB="${normalizedMiabName}" vs INWX="${normalizedInwxName}"`);
	}

	// Compare record type
	if (miabRecord.rtype !== inwxRecord.type) {
		differences.push(`Type: MIAB="${miabRecord.rtype}" vs INWX="${inwxRecord.type}"`);
	}

	// Compare record content based on type
	const contentComparison = compareRecordContent(miabRecord, inwxRecord);
	if (!contentComparison.areEqual) {
		differences.push(...contentComparison.differences);
	}

	return {
		areEqual: differences.length === 0,
		differences,
	};
}

/**
 * Compare record content based on record type
 */
function compareRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): RecordComparison {
	const differences: string[] = [];

	if (miabRecord.rtype === "MX") {
		// Parse MX record from MIAB
		const miabMx = parseMxRecord(miabRecord.value);

		// Compare priority and content
		if (miabMx.prio !== inwxRecord.prio) {
			differences.push(`MX Priority: MIAB="${miabMx.prio}" vs INWX="${inwxRecord.prio}"`);
		}

		const normalizedMiabContent = miabMx.content.replace(/\.$/, "");
		const normalizedInwxContent = inwxRecord.content.replace(/\.$/, "");

		if (normalizedMiabContent !== normalizedInwxContent) {
			differences.push(`MX Content: MIAB="${normalizedMiabContent}" vs INWX="${normalizedInwxContent}"`);
		}
	} else if (miabRecord.rtype === "SSHFP") {
		// Clean SSHFP records for comparison
		const cleanedMiabValue = cleanSshfpRecord(miabRecord.value);
		const cleanedInwxValue = cleanSshfpRecord(inwxRecord.content);

		if (cleanedMiabValue !== cleanedInwxValue) {
			differences.push(`SSHFP Content: MIAB="${cleanedMiabValue}" vs INWX="${cleanedInwxValue}"`);
		}
	} else {
		// For other record types, compare content directly
		const normalizedMiabValue = miabRecord.value.replace(/\.$/, "");
		const normalizedInwxValue = inwxRecord.content.replace(/\.$/, "");

		if (normalizedMiabValue !== normalizedInwxValue) {
			differences.push(`Content: MIAB="${normalizedMiabValue}" vs INWX="${normalizedInwxValue}"`);
		}
	}

	return {
		areEqual: differences.length === 0,
		differences,
	};
}

/**
 * Parse MX record value
 */
function parseMxRecord(value: string): { prio: number; content: string } {
	const mxParts = value.trim().split(/\s+/);
	if (mxParts.length >= 2) {
		const priority = parseInt(mxParts[0], 10);
		const content = mxParts.slice(1).join(" ");
		return { prio: priority, content };
	}
	return { prio: 10, content: value };
}

/**
 * Clean SSHFP record value
 */
function cleanSshfpRecord(value: string): string {
	return value.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
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
		const recordsResponse = await client.callApi("nameserver.info", { domain });

		if (recordsResponse.code !== INWX_SUCCESS_CODE) {
			if (recordsResponse.code === INWX_ZONE_NOT_FOUND_CODE) {
				// Zone doesn't exist, so no existing records
				return { success: true, data: null };
			}
			return {
				success: false,
				error: `Failed to fetch records for ${domain} (Code: ${recordsResponse.code}): ${recordsResponse.msg}`,
			};
		}

		const records = recordsResponse.resData?.record || [];

		// Normalize MIAB record name for comparison
		const normalizedMiabName = miabRecord.qname.replace(/\.$/, "");

		// Find matching record by name and type
		for (const record of records) {
			if (record && typeof record === "object") {
				const normalizedInwxName = (record.name || "").replace(/\.$/, "");

				if (normalizedInwxName === normalizedMiabName && record.type === miabRecord.rtype) {
					return {
						success: true,
						data: {
							id: record.id || "",
							name: record.name || "",
							type: record.type || "",
							content: record.content || "",
							ttl: record.ttl !== undefined ? parseInt(record.ttl, 10) : undefined,
							// Only set priority for record types that actually use it
							prio: record.type === "MX" && record.prio !== undefined ? parseInt(record.prio, 10) : undefined,
						},
					};
				}
			}
		}

		// No matching record found
		return { success: true, data: null };
	} catch (error) {
		return {
			success: false,
			error: `Error finding existing record: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
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
		const updateParams: Record<string, unknown> = {
			id: recordId,
		};

		// Build update parameters based on record type
		if (miabRecord.rtype === "MX") {
			const { prio, content } = parseMxRecord(miabRecord.value);
			updateParams.prio = prio;
			updateParams.content = content;
		} else if (miabRecord.rtype === "SSHFP") {
			updateParams.content = cleanSshfpRecord(miabRecord.value);
		} else {
			updateParams.content = miabRecord.value;
		}

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
		// First get list of nameserver domains
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

		// Fetch records for each domain
		for (const domainInfo of domains) {
			const domain = typeof domainInfo === "string" ? domainInfo : domainInfo.domain;
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
				// INWX records have different structure than MIAB
				const dnsRecord: DnsRecord = {
					qname: record.name || "",
					rtype: record.type || "",
					value: record.content || "",
				};

				// Add TTL if available
				if (record.ttl) {
					dnsRecord.explanation = `TTL: ${record.ttl}`;
				}

				records.push(dnsRecord);
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
			if (isDnsRecord(record)) {
				dnsRecords.push({
					qname: String(record.qname),
					rtype: String(record.rtype),
					value: String(record.value),
					explanation: record.explanation ? String(record.explanation) : undefined,
				});
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
 * Type guard for DNS record objects
 */
export function isDnsRecord(
	record: unknown,
): record is { qname: unknown; rtype: unknown; value: unknown; explanation?: unknown } {
	return typeof record === "object" && record !== null && "qname" in record && "rtype" in record && "value" in record;
}

/**
 * Initialize INWX API client with environment info
 */
export function createInwxClient(config: InwxConnectionConfig): {
	client: ApiClient;
	environmentInfo: { name: string; apiUrl: string; isOte: boolean };
} {
	const isOte = (config.environment || "ote") === "ote";
	const apiUrl = isOte ? ApiClient.API_URL_OTE : ApiClient.API_URL_LIVE;
	const environmentName = isOte ? "OTE (Test)" : "Live (Production)";

	const client = new ApiClient(apiUrl, Language.EN, config.verbose);

	return {
		client,
		environmentInfo: {
			name: environmentName,
			apiUrl,
			isOte,
		},
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
