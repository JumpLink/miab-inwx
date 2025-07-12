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
 * Parsed DNS record data
 */
interface ParsedMxRecord {
	prio: number;
	content: string;
}

interface ParsedSrvRecord {
	prio: number;
	weight: number;
	port: number;
	content: string;
}

/**
 * Record normalization result
 */
interface NormalizedRecord {
	name: string;
	content: string;
}

/**
 * Environment information for INWX API
 */
interface InwxEnvironmentInfo {
	name: string;
	apiUrl: string;
	isOte: boolean;
}

/**
 * Normalize record names by removing trailing dots
 */
function normalizeRecordName(name: string): string {
	return name.replace(/\.$/, "");
}

/**
 * Normalize record content by removing trailing dots
 */
function normalizeRecordContent(content: string): string {
	return content.replace(/\.$/, "");
}

/**
 * Normalize both MIAB and INWX records for comparison
 */
function normalizeRecordsForComparison(
	miabRecord: DnsRecord,
	inwxRecord: ExistingInwxRecord,
): { miab: NormalizedRecord; inwx: NormalizedRecord } {
	return {
		miab: {
			name: normalizeRecordName(miabRecord.qname),
			content: normalizeRecordContent(miabRecord.value),
		},
		inwx: {
			name: normalizeRecordName(inwxRecord.name),
			content: normalizeRecordContent(inwxRecord.content),
		},
	};
}

/**
 * Compare record names and types
 */
function compareBasicRecordProperties(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];
	const normalized = normalizeRecordsForComparison(miabRecord, inwxRecord);

	if (normalized.miab.name !== normalized.inwx.name) {
		differences.push(`Name: MIAB="${normalized.miab.name}" vs INWX="${normalized.inwx.name}"`);
	}

	if (miabRecord.rtype !== inwxRecord.type) {
		differences.push(`Type: MIAB="${miabRecord.rtype}" vs INWX="${inwxRecord.type}"`);
	}

	return differences;
}

/**
 * Compare MX record content
 */
function compareMxRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];
	const miabMx = parseMxRecord(miabRecord.value);

	if (miabMx.prio !== inwxRecord.prio) {
		differences.push(`MX Priority: MIAB="${miabMx.prio}" vs INWX="${inwxRecord.prio}"`);
	}

	const normalizedMiabContent = normalizeRecordContent(miabMx.content);
	const normalizedInwxContent = normalizeRecordContent(inwxRecord.content);

	if (normalizedMiabContent !== normalizedInwxContent) {
		differences.push(`MX Content: MIAB="${normalizedMiabContent}" vs INWX="${normalizedInwxContent}"`);
	}

	return differences;
}

/**
 * Compare SRV record basic properties
 */
function compareSrvRecordBasicProperties(miabSrv: ParsedSrvRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];

	if (miabSrv.prio !== inwxRecord.prio) {
		differences.push(`SRV Priority: MIAB="${miabSrv.prio}" vs INWX="${inwxRecord.prio}"`);
	}

	if (inwxRecord.weight !== undefined && miabSrv.weight !== inwxRecord.weight) {
		differences.push(`SRV Weight: MIAB="${miabSrv.weight}" vs INWX="${inwxRecord.weight}"`);
	}

	if (inwxRecord.port !== undefined && miabSrv.port !== inwxRecord.port) {
		differences.push(`SRV Port: MIAB="${miabSrv.port}" vs INWX="${inwxRecord.port}"`);
	}

	return differences;
}

/**
 * Compare SRV record content when INWX doesn't have separate weight/port fields
 */
function compareSrvRecordComplexContent(
	miabSrv: ParsedSrvRecord,
	inwxRecord: ExistingInwxRecord,
	normalizedMiabContent: string,
): string[] {
	const differences: string[] = [];
	const inwxParts = inwxRecord.content.trim().split(/\s+/);

	if (inwxParts.length >= 2) {
		const inwxPort = parseInt(inwxParts[0], 10);
		const inwxTarget = inwxParts.slice(1).join(" ").replace(/\.$/, "");

		if (miabSrv.port === inwxPort && normalizedMiabContent === inwxTarget) {
			if (miabSrv.weight !== 0) {
				differences.push(`SRV Weight: MIAB="${miabSrv.weight}" vs INWX="0 (omitted)"`);
			}
		} else if (inwxParts.length >= 3) {
			const inwxWeight = parseInt(inwxParts[0], 10);
			const inwxPort2 = parseInt(inwxParts[1], 10);
			const inwxTarget2 = inwxParts.slice(2).join(" ").replace(/\.$/, "");

			if (miabSrv.weight !== inwxWeight) {
				differences.push(`SRV Weight: MIAB="${miabSrv.weight}" vs INWX="${inwxWeight}"`);
			}
			if (miabSrv.port !== inwxPort2) {
				differences.push(`SRV Port: MIAB="${miabSrv.port}" vs INWX="${inwxPort2}"`);
			}
			if (normalizedMiabContent !== inwxTarget2) {
				differences.push(`SRV Target: MIAB="${normalizedMiabContent}" vs INWX="${inwxTarget2}"`);
			}
		} else {
			differences.push(`Content: MIAB="${miabSrv.content}" vs INWX="${inwxRecord.content}"`);
		}
	} else {
		differences.push(`Content: MIAB="${miabSrv.content}" vs INWX="${inwxRecord.content}"`);
	}

	return differences;
}

/**
 * Compare SRV record content
 */
function compareSrvRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];
	const miabSrv = parseSrvRecord(miabRecord.value);

	// Compare basic properties
	differences.push(...compareSrvRecordBasicProperties(miabSrv, inwxRecord));

	// Compare target/content
	const normalizedMiabContent = normalizeRecordContent(miabSrv.content);
	const normalizedInwxContent = normalizeRecordContent(inwxRecord.content);

	if (normalizedMiabContent !== normalizedInwxContent) {
		differences.push(`SRV Target: MIAB="${normalizedMiabContent}" vs INWX="${normalizedInwxContent}"`);
	}

	// Handle complex content comparison when INWX doesn't have separate fields
	if (inwxRecord.weight === undefined && inwxRecord.port === undefined) {
		const complexDifferences = compareSrvRecordComplexContent(miabSrv, inwxRecord, normalizedMiabContent);
		differences.push(...complexDifferences);
	}

	return differences;
}

/**
 * Compare SSHFP record content
 */
function compareSshfpRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];
	const cleanedMiabValue = cleanSshfpRecord(miabRecord.value);
	const cleanedInwxValue = cleanSshfpRecord(inwxRecord.content);

	if (cleanedMiabValue !== cleanedInwxValue) {
		differences.push(`SSHFP Content: MIAB="${cleanedMiabValue}" vs INWX="${cleanedInwxValue}"`);
	}

	return differences;
}

/**
 * Compare generic record content
 */
function compareGenericRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];
	const normalizedMiabValue = normalizeRecordContent(miabRecord.value);
	const normalizedInwxValue = normalizeRecordContent(inwxRecord.content);

	if (normalizedMiabValue !== normalizedInwxValue) {
		differences.push(`Content: MIAB="${normalizedMiabValue}" vs INWX="${normalizedInwxValue}"`);
	}

	return differences;
}

/**
 * Compare record content based on record type
 */
function compareRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): RecordComparison {
	let differences: string[] = [];

	switch (miabRecord.rtype) {
		case "MX":
			differences = compareMxRecordContent(miabRecord, inwxRecord);
			break;
		case "SRV":
			differences = compareSrvRecordContent(miabRecord, inwxRecord);
			break;
		case "SSHFP":
			differences = compareSshfpRecordContent(miabRecord, inwxRecord);
			break;
		default:
			differences = compareGenericRecordContent(miabRecord, inwxRecord);
			break;
	}

	return {
		areEqual: differences.length === 0,
		differences,
	};
}

/**
 * Compare two DNS records to check if they are equal
 */
export function compareRecords(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): RecordComparison {
	const basicDifferences = compareBasicRecordProperties(miabRecord, inwxRecord);
	const contentComparison = compareRecordContent(miabRecord, inwxRecord);
	
	const allDifferences = [...basicDifferences, ...contentComparison.differences];

	return {
		areEqual: allDifferences.length === 0,
		differences: allDifferences,
	};
}

/**
 * Parse MX record value
 */
function parseMxRecord(value: string): ParsedMxRecord {
	const mxParts = value.trim().split(/\s+/);
	if (mxParts.length >= 2) {
		const priority = parseInt(mxParts[0], 10);
		const content = mxParts.slice(1).join(" ");
		return { prio: priority, content };
	}
	return { prio: 10, content: value };
}

/**
 * Parse SRV record value
 */
function parseSrvRecord(value: string): ParsedSrvRecord {
	const srvParts = value.trim().split(/\s+/);
	if (srvParts.length >= 4) {
		const priority = parseInt(srvParts[0], 10);
		const weight = parseInt(srvParts[1], 10);
		const port = parseInt(srvParts[2], 10);
		const content = srvParts.slice(3).join(" ");
		return { prio: priority, weight, port, content };
	}
	// Fallback if parsing fails
	return { prio: 0, weight: 0, port: 80, content: value };
}

/**
 * Clean SSHFP record value
 */
function cleanSshfpRecord(value: string): string {
	return value.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Check if record type needs content matching for exact identification
 */
function recordTypeNeedsContentMatching(recordType: string): boolean {
	return ["SSHFP", "TXT", "TLSA", "A", "AAAA"].includes(recordType);
}

/**
 * Normalize content for matching based on record type
 */
function normalizeContentForMatching(content: string, recordType: string): string {
	if (recordType === "SSHFP") {
		return cleanSshfpRecord(content);
	}
	return normalizeRecordContent(content);
}

/**
 * Check if record content matches for content-sensitive record types
 */
function doesRecordContentMatch(miabRecord: DnsRecord, inwxRecord: { content: string }): boolean {
	const miabContent = normalizeContentForMatching(miabRecord.value, miabRecord.rtype);
	const inwxContent = normalizeContentForMatching(inwxRecord.content, miabRecord.rtype);
	return miabContent === inwxContent;
}

/**
 * Create ExistingInwxRecord from API response record
 */
function createExistingInwxRecord(record: any): ExistingInwxRecord {
	return {
		id: record.id || "",
		name: record.name || "",
		type: record.type || "",
		content: record.content || "",
		ttl: record.ttl !== undefined ? parseInt(record.ttl, 10) : undefined,
		prio: shouldIncludePriority(record) ? parseInt(record.prio, 10) : undefined,
		weight: shouldIncludeWeight(record) ? parseInt(record.weight, 10) : undefined,
		port: shouldIncludePort(record) ? parseInt(record.port, 10) : undefined,
	};
}

/**
 * Check if record should include priority field
 */
function shouldIncludePriority(record: any): boolean {
	return (record.type === "MX" || record.type === "SRV") && record.prio !== undefined;
}

/**
 * Check if record should include weight field
 */
function shouldIncludeWeight(record: any): boolean {
	return record.type === "SRV" && record.weight !== undefined;
}

/**
 * Check if record should include port field
 */
function shouldIncludePort(record: any): boolean {
	return record.type === "SRV" && record.port !== undefined;
}

/**
 * Find matching record in records array
 */
function findMatchingRecord(records: any[], miabRecord: DnsRecord): ExistingInwxRecord | null {
	const normalizedMiabName = normalizeRecordName(miabRecord.qname);

	for (const record of records) {
		if (!record || typeof record !== "object") continue;

		const normalizedInwxName = normalizeRecordName(record.name || "");
		const isNameAndTypeMatch = normalizedInwxName === normalizedMiabName && record.type === miabRecord.rtype;

		if (!isNameAndTypeMatch) continue;

		const needsContentMatching = recordTypeNeedsContentMatching(miabRecord.rtype);

		if (needsContentMatching) {
			if (doesRecordContentMatch(miabRecord, record)) {
				return createExistingInwxRecord(record);
			}
		} else {
			return createExistingInwxRecord(record);
		}
	}

	return null;
}

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
 * Get domain name from domain info object
 */
function getDomainName(domainInfo: unknown): string | null {
	if (typeof domainInfo === "string") return domainInfo;
	if (typeof domainInfo === "object" && domainInfo !== null && "domain" in domainInfo) {
		return String((domainInfo as { domain: unknown }).domain);
	}
	return null;
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
 * Convert INWX record to DNS record format
 */
function convertInwxRecordToDnsRecord(record: any): DnsRecord {
	const dnsRecord: DnsRecord = {
		qname: record.name || "",
		rtype: record.type || "",
		value: record.content || "",
	};

	if (record.ttl) {
		dnsRecord.explanation = `TTL: ${record.ttl}`;
	}

	return dnsRecord;
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
 * Convert raw record data to DNS record
 */
function convertRawRecordToDnsRecord(record: unknown): DnsRecord | null {
	if (!isDnsRecord(record)) return null;

	return {
		qname: String(record.qname),
		rtype: String(record.rtype),
		value: String(record.value),
		explanation: record.explanation ? String(record.explanation) : undefined,
	};
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
 * Type guard for DNS record objects
 */
export function isDnsRecord(
	record: unknown,
): record is { qname: unknown; rtype: unknown; value: unknown; explanation?: unknown } {
	return typeof record === "object" && record !== null && "qname" in record && "rtype" in record && "value" in record;
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
