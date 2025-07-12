import { MiabClient } from "@miab-inwx/miab-client";
import { ApiClient, Language } from "domrobot-client";
import type { CommandResult } from "../../types/index.ts";
import type {
	ConflictResolutionStrategy,
	DnsRecord,
	DnsZone,
	MigrateDnsData,
	MigrateDnsOptions,
	MigrationResult,
} from "../../types/migrate-dns.ts";
import { resolveRecordConflict } from "../../utils/conflict-resolution.ts";
import { findExistingInwxRecord, updateInwxRecord } from "../../utils/dns.ts";

// Constants
const INWX_SUCCESS_CODE = 1000;
const INWX_ZONE_NOT_FOUND_CODE = 2303;
const INWX_RECORD_EXISTS_CODE = 2302;
const INWX_POLICY_VIOLATION_CODE = 2308;
const LARGE_ZONE_THRESHOLD = 50;
const RECORD_PROGRESS_THRESHOLD = 10;
const API_DELAY_MS = 100;

/**
 * Configuration for API clients
 */
interface ApiClientConfig {
	miab: {
		baseUrl: string;
		auth: string;
		verbose?: boolean;
	};
	inwx: {
		client: ApiClient;
		username: string;
		password: string;
		sharedSecret?: string;
		verbose?: boolean;
	};
}

/**
 * Migration context for tracking progress
 */
interface MigrationContext {
	totalZones: number;
	processedZones: number;
	successfulZones: number;
	failedZones: number;
	startTime: number;
	dryRun: boolean;
	verbose: boolean;
	conflictResolution: ConflictResolutionStrategy;
}

/**
 * Migrate DNS records from MIAB to INWX
 */
export async function migrateDnsRecords(options: MigrateDnsOptions): Promise<CommandResult<MigrateDnsData>> {
	try {
		const validationResult = validateMigrationOptions(options);
		if (!validationResult.isValid) {
			return createErrorResult(validationResult.error);
		}

		const { miab, inwx, dryRun = false } = options;
		const environment = inwx.environment || "ote";
		const environmentInfo = getEnvironmentInfo(environment);

		logMigrationStart(environmentInfo.name, dryRun, miab.verbose);

		const apiConfig = await initializeApiClients(miab, inwx, environmentInfo.apiUrl);
		if (!apiConfig.success) {
			return createErrorResult(apiConfig.error);
		}

		const dnsZones = await fetchAndParseDnsZones(apiConfig.data.miab);
		if (!dnsZones.success) {
			return createErrorResult(dnsZones.error);
		}

		logMigrationOverview(dnsZones.data, environmentInfo.name, dryRun);

		const migrationContext: MigrationContext = {
			totalZones: dnsZones.data.length,
			processedZones: 0,
			successfulZones: 0,
			failedZones: 0,
			startTime: Date.now(),
			dryRun,
			verbose: miab.verbose || false,
			conflictResolution: options.conflictResolution || "skip",
		};

		const migrationResults = await executeMigration(dnsZones.data, apiConfig.data.inwx.client, migrationContext);

		await cleanupApiClient(apiConfig.data.inwx.client);

		const finalResult = createMigrationResult(options, environmentInfo, migrationResults, migrationContext);

		logMigrationCompletion(migrationContext, migrationResults);

		return finalResult;
	} catch (error) {
		return createErrorResult(error instanceof Error ? error.message : "DNS migration failed");
	}
}

/**
 * Validate migration options
 */
function validateMigrationOptions(options: MigrateDnsOptions): { isValid: boolean; error?: string } {
	const { miab, inwx } = options;

	if (!miab.apiUrl || !miab.email || !miab.password) {
		return {
			isValid: false,
			error: "Missing required MIAB connection parameters: apiUrl, email, password",
		};
	}

	if (!inwx.username || !inwx.password) {
		return {
			isValid: false,
			error: "Missing required INWX connection parameters: username, password",
		};
	}

	return { isValid: true };
}

/**
 * Get environment information
 */
function getEnvironmentInfo(environment: string) {
	const isOte = environment === "ote";
	return {
		apiUrl: isOte ? ApiClient.API_URL_OTE : ApiClient.API_URL_LIVE,
		name: isOte ? "OTE (Test)" : "Live (Production)",
		isOte,
	};
}

/**
 * Initialize and test API clients
 */
async function initializeApiClients(
	miabConfig: MigrateDnsOptions["miab"],
	inwxConfig: MigrateDnsOptions["inwx"],
	inwxApiUrl: string,
): Promise<CommandResult<ApiClientConfig>> {
	const miabAuth = `${miabConfig.email}:${miabConfig.password}`;
	const inwxClient = new ApiClient(inwxApiUrl, Language.EN, inwxConfig.verbose);

	// Test MIAB connection
	const miabTest = await testMiabConnection(miabConfig.apiUrl, miabAuth, miabConfig.verbose);
	if (!miabTest.success) {
		return { success: false, error: miabTest.error };
	}

	// Test INWX connection
	const inwxTest = await testInwxConnection(inwxClient, inwxConfig);
	if (!inwxTest.success) {
		return { success: false, error: inwxTest.error };
	}

	return {
		success: true,
		data: {
			miab: {
				baseUrl: miabConfig.apiUrl,
				auth: miabAuth,
				verbose: miabConfig.verbose,
			},
			inwx: {
				client: inwxClient,
				username: inwxConfig.username,
				password: inwxConfig.password,
				sharedSecret: inwxConfig.sharedSecret,
				verbose: inwxConfig.verbose,
			},
		},
	};
}

/**
 * Test MIAB API connection
 */
async function testMiabConnection(apiUrl: string, auth: string, verbose?: boolean): Promise<CommandResult<string[]>> {
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
async function testInwxConnection(client: ApiClient, config: MigrateDnsOptions["inwx"]): Promise<CommandResult<void>> {
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
async function fetchAndParseDnsZones(miabConfig: ApiClientConfig["miab"]): Promise<CommandResult<DnsZone[]>> {
	try {
		const response = await MiabClient.getDnsDump({
			baseUrl: miabConfig.baseUrl,
			auth: miabConfig.auth,
			throwOnError: true,
		});

		if (!response.data || !Array.isArray(response.data)) {
			return { success: false, error: "Invalid response from MIAB API when fetching DNS dump" };
		}

		const dnsZones = parseMiabDnsDump(response.data);

		if (miabConfig.verbose) {
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
 * Execute the migration for all zones
 */
async function executeMigration(
	zones: DnsZone[],
	inwxClient: ApiClient,
	context: MigrationContext,
): Promise<MigrationResult[]> {
	const results: MigrationResult[] = [];

	console.log("🚀 Starting zone migration...\n");

	for (let i = 0; i < zones.length; i++) {
		const zone = zones[i];
		const zoneProgress = `[${i + 1}/${zones.length}]`;

		console.log(`${zoneProgress} 🌐 Processing zone: ${zone.domain} (${zone.records.length} records)`);

		const result = await migrateZone(zone, inwxClient, context, zoneProgress);
		results.push(result);

		updateMigrationProgress(context, result);
		logZoneResult(result, context.dryRun, zoneProgress);

		if (shouldShowOverallProgress(i, zones.length)) {
			logOverallProgress(i + 1, zones.length, results, context);
		}
	}

	return results;
}

/**
 * Update migration progress counters
 */
function updateMigrationProgress(context: MigrationContext, result: MigrationResult): void {
	context.processedZones++;
	if (result.failedRecords === 0) {
		context.successfulZones++;
	} else {
		context.failedZones++;
	}
}

/**
 * Check if overall progress should be shown
 */
function shouldShowOverallProgress(currentIndex: number, totalZones: number): boolean {
	return (currentIndex + 1) % 5 === 0 || currentIndex === totalZones - 1;
}

/**
 * Parse MIAB DNS dump into structured zones
 */
function parseMiabDnsDump(dumpData: unknown[]): DnsZone[] {
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
function isDnsRecord(
	record: unknown,
): record is { qname: unknown; rtype: unknown; value: unknown; explanation?: unknown } {
	return typeof record === "object" && record !== null && "qname" in record && "rtype" in record && "value" in record;
}

/**
 * Migrate a single DNS zone
 */
async function migrateZone(
	zone: DnsZone,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
): Promise<MigrationResult> {
	const result: MigrationResult = {
		zone: zone.domain,
		totalRecords: zone.records.length,
		processedRecords: 0,
		successfulRecords: 0,
		failedRecords: 0,
		skippedRecords: 0,
		updatedRecords: 0,
		errors: [],
		warnings: [],
	};

	const zoneSetupResult = await setupDnsZone(zone, inwxClient, context, zoneProgress);
	if (!zoneSetupResult.success) {
		result.errors.push(...zoneSetupResult.errors);
		result.warnings.push(...zoneSetupResult.warnings);
		return result;
	}

	await migrateZoneRecords(zone, inwxClient, context, zoneProgress, result);

	return result;
}

/**
 * Setup DNS zone (check existence, create if needed)
 */
async function setupDnsZone(
	zone: DnsZone,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
): Promise<{ success: boolean; errors: string[]; warnings: string[] }> {
	const result = { success: true, errors: [] as string[], warnings: [] as string[] };

	const zoneExists = await checkZoneExists(zone.domain, inwxClient, context, zoneProgress);
	if (!zoneExists.success) {
		result.success = false;
		result.errors.push(...zoneExists.errors);
		result.warnings.push(...zoneExists.warnings);
		return result;
	}

	if (!zoneExists.exists) {
		const createResult = await createDnsZone(zone.domain, inwxClient, context, zoneProgress);
		if (!createResult.success) {
			result.success = false;
			result.errors.push(...createResult.errors);
			return result;
		}
		result.warnings.push(...createResult.warnings);
	}

	return result;
}

/**
 * Check if DNS zone exists
 */
async function checkZoneExists(
	domain: string,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
): Promise<{ success: boolean; exists: boolean; errors: string[]; warnings: string[] }> {
	const result = { success: true, exists: false, errors: [] as string[], warnings: [] as string[] };

	try {
		if (context.dryRun) {
			return await checkZoneExistsInDryRun(domain, inwxClient, context, zoneProgress);
		}

		const zoneInfoResponse = await inwxClient.callApi("nameserver.info", { domain });

		if (zoneInfoResponse.code === INWX_SUCCESS_CODE) {
			result.exists = true;
			if (context.verbose) {
				console.log(`${zoneProgress}   ✅ DNS zone ${domain} already exists`);
			}
		} else if (zoneInfoResponse.code === INWX_ZONE_NOT_FOUND_CODE) {
			result.exists = false;
			if (context.verbose) {
				console.log(`${zoneProgress}   ℹ️  DNS zone ${domain} does not exist, checking if domain is registered`);
			}

			const domainCheckResult = await checkDomainRegistration(domain, inwxClient, context, zoneProgress);
			if (!domainCheckResult.success) {
				result.success = false;
				result.warnings.push(...domainCheckResult.warnings);
				return result;
			}
		} else {
			result.success = false;
			result.errors.push(`Failed to check DNS zone ${domain}: ${zoneInfoResponse.msg}`);
			if (context.verbose) {
				console.error(`${zoneProgress}   ❌ Failed to check DNS zone ${domain}: ${zoneInfoResponse.msg}`);
			}
		}
	} catch (error) {
		result.success = false;
		result.errors.push(
			`Error checking DNS zone ${domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		if (context.verbose) {
			console.error(
				`${zoneProgress}   ❌ Error checking DNS zone ${domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	return result;
}

/**
 * Check zone existence in dry run mode
 */
async function checkZoneExistsInDryRun(
	domain: string,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
): Promise<{ success: boolean; exists: boolean; errors: string[]; warnings: string[] }> {
	const result = { success: true, exists: false, errors: [] as string[], warnings: [] as string[] };

	if (context.verbose) {
		console.log(`${zoneProgress}   [DRY RUN] Would check if DNS zone ${domain} exists`);
	}

	const domainCheckResult = await checkDomainRegistration(domain, inwxClient, context, zoneProgress);
	if (!domainCheckResult.success) {
		result.success = false;
		result.warnings.push(...domainCheckResult.warnings);
	}

	return result;
}

/**
 * Check if domain is registered
 */
async function checkDomainRegistration(
	domain: string,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
): Promise<{ success: boolean; warnings: string[] }> {
	const result = { success: true, warnings: [] as string[] };

	try {
		const domainListResponse = await inwxClient.callApi("domain.list", {});

		if (domainListResponse.code === INWX_SUCCESS_CODE && domainListResponse.resData?.domains) {
			const registeredDomains = domainListResponse.resData.domains;
			const isDomainRegistered = registeredDomains.some(
				(registeredDomain: { domain: string }) => registeredDomain.domain === domain,
			);

			if (!isDomainRegistered) {
				result.success = false;
				result.warnings.push(`Domain ${domain} is not registered in your INWX account - cannot create DNS zone`);
				if (context.verbose) {
					console.log(`${zoneProgress}   ⚠️  Domain ${domain} is not registered in your INWX account`);
				}
			} else if (context.verbose) {
				console.log(`${zoneProgress}   ✅ Domain ${domain} is registered, can create DNS zone`);
			}
		}
	} catch (error) {
		result.success = false;
		result.warnings.push(
			`Error checking domain registration for ${domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return result;
}

/**
 * Create DNS zone
 */
async function createDnsZone(
	domain: string,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
): Promise<{ success: boolean; errors: string[]; warnings: string[] }> {
	const result = { success: true, errors: [] as string[], warnings: [] as string[] };

	try {
		if (context.dryRun) {
			if (context.verbose) {
				console.log(`${zoneProgress}   [DRY RUN] Would create DNS zone ${domain}`);
			}
			result.warnings.push(`DNS zone ${domain} would be created`);
		} else {
			const createZoneResponse = await inwxClient.callApi("nameserver.create", {
				domain,
				type: "MASTER",
			});

			if (createZoneResponse.code === INWX_SUCCESS_CODE) {
				if (context.verbose) {
					console.log(`${zoneProgress}   ✅ Created DNS zone ${domain}`);
				}
				result.warnings.push(`DNS zone ${domain} was created`);
			} else {
				result.success = false;
				result.errors.push(`Failed to create DNS zone ${domain}: ${createZoneResponse.msg}`);
				if (context.verbose) {
					console.error(`${zoneProgress}   ❌ Failed to create DNS zone ${domain}: ${createZoneResponse.msg}`);
				}
			}
		}
	} catch (error) {
		result.success = false;
		result.errors.push(
			`Error creating DNS zone ${domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		if (context.verbose) {
			console.error(
				`${zoneProgress}   ❌ Error creating DNS zone ${domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	return result;
}

/**
 * Migrate all records in a zone
 */
async function migrateZoneRecords(
	zone: DnsZone,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
	result: MigrationResult,
): Promise<void> {
	const showRecordProgress = zone.records.length >= RECORD_PROGRESS_THRESHOLD;
	const recordProgressThreshold = Math.max(1, Math.floor(zone.records.length / 10));

	for (let i = 0; i < zone.records.length; i++) {
		const record = zone.records[i];
		result.processedRecords++;

		if (showRecordProgress && context.verbose && (i + 1) % recordProgressThreshold === 0) {
			const recordProgress = Math.round(((i + 1) / zone.records.length) * 100);
			console.log(`${zoneProgress}   📄 Record progress: ${recordProgress}% (${i + 1}/${zone.records.length})`);
		}

		await migrateRecord(record, zone.domain, inwxClient, context, zoneProgress, result);

		if (!context.dryRun && zone.records.length > LARGE_ZONE_THRESHOLD) {
			await delay(API_DELAY_MS);
		}
	}

	if (showRecordProgress && (context.verbose || result.failedRecords > 0)) {
		logZoneRecordCompletion(result, zoneProgress);
	}
}

/**
 * Migrate a single DNS record
 */
async function migrateRecord(
	record: DnsRecord,
	domain: string,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
	result: MigrationResult,
): Promise<void> {
	try {
		if (context.dryRun) {
			if (context.verbose) {
				console.log(
					`${zoneProgress}   [DRY RUN] Would create ${record.rtype} record: ${record.qname} -> ${record.value}`,
				);
			}
			result.successfulRecords++;
			return;
		}

		// Check if record already exists in INWX
		const existingRecordResult = await findExistingInwxRecord(inwxClient, domain, record);
		if (!existingRecordResult.success) {
			result.failedRecords++;
			result.errors.push(existingRecordResult.error);
			if (context.verbose) {
				console.error(`${zoneProgress}   ❌ ${existingRecordResult.error}`);
			}
			return;
		}

		const existingRecord = existingRecordResult.data;

		if (existingRecord) {
			// Record exists, handle conflict resolution
			const conflictResolution = context.conflictResolution || "skip";
			const action = await resolveRecordConflict(
				record,
				existingRecord,
				conflictResolution,
				zoneProgress,
				context.verbose,
			);

			if (action === "skip") {
				result.skippedRecords++;
				if (context.verbose) {
					console.log(`${zoneProgress}   ⏭️  Skipped existing record: ${record.rtype} ${record.qname}`);
				}
				return;
			} else if (action === "overwrite") {
				// Update existing record
				const updateResult = await updateInwxRecord(inwxClient, domain, existingRecord.id, record);
				if (updateResult.success) {
					result.updatedRecords++;
					result.successfulRecords++;
					if (context.verbose) {
						const displayValue =
							record.rtype === "MX"
								? `${buildRecordParams(record, domain).prio} ${buildRecordParams(record, domain).content}`
								: record.value;
						console.log(`${zoneProgress}   🔄 Updated ${record.rtype} record: ${record.qname} -> ${displayValue}`);
					}
				} else {
					result.failedRecords++;
					result.errors.push(updateResult.error);
					if (context.verbose) {
						console.error(`${zoneProgress}   ❌ Failed to update ${record.rtype} record: ${updateResult.error}`);
					}
				}
				return;
			}
		}

		// Record doesn't exist, create new one
		const recordParams = buildRecordParams(record, domain);
		const createResponse = await inwxClient.callApi("nameserver.createRecord", recordParams);

		handleRecordCreationResponse(createResponse, record, recordParams, result, context, zoneProgress);
	} catch (error) {
		result.failedRecords++;
		const errorMsg = `Error processing ${record.rtype} record ${record.qname}: ${error instanceof Error ? error.message : "Unknown error"}`;
		result.errors.push(errorMsg);
		if (context.verbose) {
			console.error(`${zoneProgress}   ❌ ${errorMsg}`);
		}
	}
}

/**
 * Build record parameters for API call
 */
function buildRecordParams(record: DnsRecord, domain: string): Record<string, unknown> {
	const params: Record<string, unknown> = {
		domain,
		type: record.rtype,
		name: record.qname,
	};

	if (record.rtype === "MX") {
		const { prio, content } = parseMxRecord(record.value);
		params.prio = prio;
		params.content = content;
	} else if (record.rtype === "SSHFP") {
		params.content = cleanSshfpRecord(record.value);
	} else {
		params.content = record.value;
	}

	return params;
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
 * Handle record creation response
 */
function handleRecordCreationResponse(
	response: { code: number; msg: string },
	record: DnsRecord,
	recordParams: Record<string, unknown>,
	result: MigrationResult,
	context: MigrationContext,
	zoneProgress: string,
): void {
	if (response.code === INWX_SUCCESS_CODE) {
		result.successfulRecords++;
		if (context.verbose) {
			const displayValue = record.rtype === "MX" ? `${recordParams.prio} ${recordParams.content}` : record.value;
			console.log(`${zoneProgress}   ✅ Created ${record.rtype} record: ${record.qname} -> ${displayValue}`);
		}
	} else if (response.code === INWX_RECORD_EXISTS_CODE) {
		result.successfulRecords++;
		if (context.verbose) {
			const displayValue = record.rtype === "MX" ? `${recordParams.prio} ${recordParams.content}` : record.value;
			console.log(`${zoneProgress}   ℹ️  ${record.rtype} record already exists: ${record.qname} -> ${displayValue}`);
		}
	} else if (response.code === INWX_POLICY_VIOLATION_CODE) {
		handlePolicyViolation(record, recordParams, result, context, zoneProgress, response.msg);
	} else {
		result.failedRecords++;
		const errorMsg = `Failed to create ${record.rtype} record ${record.qname}: ${response.msg}`;
		result.errors.push(errorMsg);
		if (context.verbose) {
			console.error(`${zoneProgress}   ❌ ${errorMsg}`);
		}
	}
}

/**
 * Handle policy violation errors
 */
function handlePolicyViolation(
	record: DnsRecord,
	recordParams: Record<string, unknown>,
	result: MigrationResult,
	context: MigrationContext,
	zoneProgress: string,
	errorMessage: string,
): void {
	if (record.rtype === "MX" && recordParams.prio === 0 && recordParams.content === ".") {
		// Null MX record - treat as warning, not error
		result.successfulRecords++;
		result.warnings.push(`Null MX record not allowed by INWX policy: ${record.qname}`);
		if (context.verbose) {
			console.log(
				`${zoneProgress}   ⚠️  Null MX record not allowed by INWX policy: ${record.qname} -> ${recordParams.prio} ${recordParams.content}`,
			);
		}
	} else {
		// Other policy violations - treat as error
		result.failedRecords++;
		const errorMsg = `Policy violation for ${record.rtype} record ${record.qname}: ${errorMessage}`;
		result.errors.push(errorMsg);
		if (context.verbose) {
			console.error(`${zoneProgress}   ❌ ${errorMsg}`);
		}
	}
}

/**
 * Cleanup API client
 */
async function cleanupApiClient(inwxClient: ApiClient): Promise<void> {
	try {
		await inwxClient.logout();
	} catch (_error) {
		// Ignore logout errors
	}
}

/**
 * Create error result
 */
function createErrorResult(error: string): CommandResult<MigrateDnsData> {
	return { success: false, error };
}

/**
 * Create successful migration result
 */
function createMigrationResult(
	options: MigrateDnsOptions,
	environmentInfo: { apiUrl: string; name: string; isOte: boolean },
	migrationResults: MigrationResult[],
	context: MigrationContext,
): CommandResult<MigrateDnsData> {
	const { miab, inwx, dryRun } = options;

	return {
		success: true,
		message: `DNS migration completed: ${context.successfulZones}/${context.processedZones} zones migrated successfully`,
		data: {
			miab: {
				baseUrl: miab.apiUrl,
				username: miab.email,
				authenticated: true,
				zones: [], // Would be populated from the test connection
			},
			inwx: {
				username: inwx.username,
				environment: inwx.environment || "ote",
				apiUrl: environmentInfo.apiUrl,
				authenticated: true,
			},
			migration: {
				dryRun: dryRun || false,
				results: migrationResults,
				totalZones: context.totalZones,
				processedZones: context.processedZones,
				successfulZones: context.successfulZones,
				failedZones: context.failedZones,
				timestamp: new Date().toISOString(),
			},
		},
	};
}

/**
 * Utility function for delays
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Logging functions
function logMigrationStart(environmentName: string, dryRun: boolean, verbose?: boolean): void {
	if (verbose) {
		console.log(`Starting DNS migration from MIAB to INWX ${environmentName} environment...`);
		if (dryRun) {
			console.log("DRY RUN MODE: No actual changes will be made");
		}
	}
}

function logMigrationOverview(zones: DnsZone[], environmentName: string, dryRun: boolean): void {
	const totalRecords = zones.reduce((sum, zone) => sum + zone.records.length, 0);

	console.log(`📋 Migration Overview:`);
	console.log(`  Total DNS Zones: ${zones.length}`);
	console.log(`  Total DNS Records: ${totalRecords}`);
	console.log(`  Target Environment: INWX ${environmentName}`);

	if (dryRun) {
		console.log(`  Mode: DRY RUN (no changes will be made)`);
	} else {
		const modeText = environmentName.includes("Test")
			? "LIVE MIGRATION (TEST ENVIRONMENT)"
			: "LIVE MIGRATION (PRODUCTION ENVIRONMENT)";
		console.log(`  Mode: ${modeText}`);
	}
	console.log("");
}

function logZoneResult(result: MigrationResult, dryRun: boolean, zoneProgress: string): void {
	if (result.failedRecords === 0) {
		console.log(
			`${zoneProgress} ✅ Zone ${result.zone}: ${result.successfulRecords}/${result.totalRecords} records ${dryRun ? "verified" : "migrated"}`,
		);
	} else {
		console.log(
			`${zoneProgress} ❌ Zone ${result.zone}: ${result.successfulRecords}/${result.totalRecords} records successful, ${result.failedRecords} failed`,
		);
		if (result.errors.length > 0) {
			console.log(
				`${zoneProgress}    Errors: ${result.errors.slice(0, 3).join(", ")}${result.errors.length > 3 ? "..." : ""}`,
			);
		}
	}
}

function logOverallProgress(
	currentZone: number,
	totalZones: number,
	results: MigrationResult[],
	context: MigrationContext,
): void {
	const processedRecords = results.reduce((sum, result) => sum + result.successfulRecords, 0);
	const totalPossibleRecords = results.reduce((sum, result) => sum + result.totalRecords, 0);
	const progressPercent = Math.round((currentZone / totalZones) * 100);
	const elapsedTime = Math.round((Date.now() - context.startTime) / 1000);

	console.log(
		`📊 Progress: ${progressPercent}% complete (${currentZone}/${totalZones} zones, ${processedRecords}/${totalPossibleRecords} records, ${elapsedTime}s elapsed)\n`,
	);
}

function logZoneRecordCompletion(result: MigrationResult, zoneProgress: string): void {
	const successRate = Math.round((result.successfulRecords / result.totalRecords) * 100);
	console.log(
		`${zoneProgress}   📄 Zone completed: ${successRate}% success rate (${result.successfulRecords}/${result.totalRecords} records)`,
	);

	if (result.failedRecords > 0) {
		console.log(`${zoneProgress}   ⚠️  ${result.failedRecords} records failed in this zone`);
	}
}

function logMigrationCompletion(context: MigrationContext, results: MigrationResult[]): void {
	const totalElapsedTime = Math.round((Date.now() - context.startTime) / 1000);
	console.log(`🎉 Migration completed in ${totalElapsedTime} seconds!`);
	console.log(`   Zones: ${context.successfulZones}/${context.processedZones} successful`);
	console.log(
		`   Records: ${results.reduce((sum, result) => sum + result.successfulRecords, 0)}/${results.reduce((sum, result) => sum + result.totalRecords, 0)} successful`,
	);
	console.log("");
}
