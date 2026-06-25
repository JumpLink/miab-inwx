import { request as httpsRequest } from "node:https";
import { MiabClient } from "@miab-inwx/miab-client";
import { ApiClient, Language } from "domrobot-client";
import { minimatch } from "minimatch";
import type { CommandResult } from "../../types/index.ts";
import type {
	ApiClientConfig,
	DnsRecord,
	DnsZone,
	ExistingInwxRecord,
	MigrateDnsData,
	MigrateDnsOptions,
	MigrationContext,
	MigrationResult,
} from "../../types/migrate-dns.ts";
import { resolveRecordConflict } from "../../utils/conflict-resolution.ts";
import {
	API_DELAY_MS,
	INWX_POLICY_VIOLATION_CODE,
	INWX_RECORD_EXISTS_CODE,
	INWX_SUCCESS_CODE,
	INWX_ZONE_NOT_FOUND_CODE,
	LARGE_ZONE_THRESHOLD,
	RECORD_PROGRESS_THRESHOLD,
} from "../../utils/constants.ts";
import { findExistingInwxRecord, updateInwxRecord } from "../../utils/dns.ts";
import {
	allowsMultipleRecords,
	doesMultiRecordMatch,
	doesRecordContentMatch,
	normalizeRecordName,
} from "../../utils/dns-helpers.ts";
import { getAllDomains } from "../../utils/inwx-helpers.ts";
import { cleanSshfpRecord, parseMxRecord, parseSrvRecord } from "../../utils/record-parsers.ts";

/**
 * Details about a migration conflict for logging purposes
 */
interface ConflictDetails {
	recordName: string;
	recordType: string;
	miabRecords: DnsRecord[];
	conflictingInwxRecords: Array<{ content?: string }>;
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

		// Use glob patterns for inclusion/exclusion
		const include = options.include && options.include.length > 0 ? options.include : ["*"];
		const exclude = options.exclude || [];
		const filteredZones = dnsZones.data.filter((zone) => {
			const isIncluded = include.some((pattern) => minimatch(zone.domain, pattern));
			const isExcluded = exclude.some((pattern) => minimatch(zone.domain, pattern));
			return isIncluded && !isExcluded;
		});

		logMigrationOverview(dnsZones.data, filteredZones, include, exclude, environmentInfo.name, dryRun);

		const migrationContext: MigrationContext = {
			totalZones: filteredZones.length,
			processedZones: 0,
			successfulZones: 0,
			failedZones: 0,
			startTime: Date.now(),
			dryRun,
			verbose: miab.verbose || false,
			conflictResolution: options.conflictResolution || "skip",
			purgeExisting: options.purgeExisting || false,
			include,
			exclude,
		};

		const migrationResults = await executeMigration(filteredZones, apiConfig.data.inwx.client, migrationContext);

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
	// Reduce noise: disable domrobot internal verbose logging; rely on our own structured logs
	const inwxClient = new ApiClient(inwxApiUrl, Language.EN, false);

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

		// Remove duplicates before storing
		const uniqueRecords = removeDuplicateRecords(dnsRecords);
		zones.set(domain, uniqueRecords);
	}

	return Array.from(zones.entries()).map(([domain, records]) => ({
		domain,
		records,
	}));
}

/**
 * Remove duplicate DNS records from a list
 */
function removeDuplicateRecords(records: DnsRecord[]): DnsRecord[] {
	const seen = new Set<string>();
	const uniqueRecords: DnsRecord[] = [];
	const duplicates: { record: DnsRecord; count: number }[] = [];

	for (const record of records) {
		// Create a unique key for the record
		const key = `${record.qname}|${record.rtype}|${record.value}`;

		if (seen.has(key)) {
			// Track duplicates for logging
			const existing = duplicates.find(
				(d) => d.record.qname === record.qname && d.record.rtype === record.rtype && d.record.value === record.value,
			);
			if (existing) {
				existing.count++;
			} else {
				duplicates.push({ record, count: 2 });
			}
		} else {
			seen.add(key);
			uniqueRecords.push(record);
		}
	}

	// Log duplicates if any were found
	if (duplicates.length > 0) {
		console.log(`⚠️  Found ${duplicates.length} duplicate record types in MIAB data:`);
		for (const dup of duplicates) {
			console.log(`   ${dup.record.rtype} ${dup.record.qname} -> ${dup.record.value} (${dup.count} copies, kept 1)`);
		}
		console.log(`   Removed ${records.length - uniqueRecords.length} duplicate records total\n`);
	}

	return uniqueRecords;
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

	// Purge existing records if requested
	if (context.purgeExisting) {
		const purgeOutcome = await purgeExistingZoneRecords(zone.domain, inwxClient, context, zoneProgress);
		result.warnings.push(...purgeOutcome.warnings);
		if (!purgeOutcome.success) {
			result.errors.push(...purgeOutcome.errors);
			return result;
		}
	}

	// Check for existing records that might conflict with migration
	await checkExistingRecordsForMigration(zone, inwxClient, context, zoneProgress, result);

	// In overwrite mode, pre-delete INWX records that don't match any MIAB record
	// for multi-record types (A, AAAA, MX, SRV, TXT, NS) so they get recreated correctly
	await deleteNonMatchingMultiRecords(zone, inwxClient, context, zoneProgress, result);

	await migrateZoneRecords(zone, inwxClient, context, zoneProgress, result);

	// After DNS changes, check MTA-STS policy reachability if relevant
	await checkMtaStsPolicyAvailability(zone, context, zoneProgress, result);

	return result;
}

/**
 * Check for existing records that might conflict during MIAB migration
 */
async function checkExistingRecordsForMigration(
	zone: DnsZone,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
	result: MigrationResult,
): Promise<void> {
	if (context.dryRun) {
		return;
	}

	try {
		const existingRecords = await fetchExistingInwxRecords(inwxClient, zone.domain);
		if (!existingRecords) {
			return;
		}

		const miabRecordGroups = groupMiabRecordsByNameAndType(zone.records);
		const conflictAnalysis = analyzeRecordConflicts(miabRecordGroups, existingRecords);

		logMigrationConflicts(conflictAnalysis, context, zoneProgress, result);
	} catch (error) {
		if (context.verbose) {
			console.log(
				`${zoneProgress}   ⚠️  Could not check for migration conflicts: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}
}

/**
 * Fetch existing INWX records for a domain
 */
async function fetchExistingInwxRecords(inwxClient: ApiClient, domain: string): Promise<unknown[] | null> {
	const recordsResponse = await inwxClient.callApi("nameserver.info", { domain });

	if (recordsResponse.code !== INWX_SUCCESS_CODE) {
		return null;
	}

	return recordsResponse.resData?.record || [];
}

/**
 * Delete existing INWX records that don't match any MIAB record for multi-record types.
 * This pre-migration step ensures that in overwrite mode, the full set of MIAB records
 * replaces the existing INWX records rather than each MIAB record overwriting the same one.
 */
async function deleteNonMatchingMultiRecords(
	zone: DnsZone,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
	result: MigrationResult,
): Promise<void> {
	if (context.conflictResolution !== "overwrite" || context.dryRun) {
		return;
	}

	try {
		const existingRecords = await fetchExistingInwxRecords(inwxClient, zone.domain);
		if (!existingRecords) {
			return;
		}

		const miabRecordGroups = groupMiabRecordsByNameAndType(zone.records);

		for (const [key, miabRecords] of miabRecordGroups) {
			const [recordName, recordType] = key.split("|");

			if (!allowsMultipleRecords(recordType)) continue;

			// TXT records on a name are independent values (SPF, DKIM, DMARC and
			// third-party verification tokens such as google-site-verification).
			// Bulk-deleting them by name match destroys records MIAB does not manage;
			// TXT replacement is handled semantically by prefix in the per-record path
			// (deleteExistingTxtRecordsByPrefix), so skip TXT in this destructive pass.
			if (recordType === "TXT") continue;

			const normalizedMiabName = normalizeRecordName(recordName);
			const existingForNameType = existingRecords.filter(
				(r: { name?: string; type?: string }) =>
					normalizeRecordName(r.name || "") === normalizedMiabName && r.type === recordType,
			) as Array<{ id?: string; name?: string; type?: string; content?: string; prio?: number | string }>;

			if (existingForNameType.length === 0) continue;

			for (const inwxRecord of existingForNameType) {
				const hasMatch = miabRecords.some((miabRecord) =>
					doesMultiRecordMatch(miabRecord, { content: inwxRecord.content || "", prio: inwxRecord.prio }),
				);

				if (!hasMatch && inwxRecord.id) {
					const del = await inwxClient.callApi("nameserver.deleteRecord", { id: inwxRecord.id });
					if (del.code === INWX_SUCCESS_CODE) {
						if (context.verbose) {
							console.log(
								`${zoneProgress}   🧹 Deleted non-matching ${recordType} record: ${recordName} -> ${inwxRecord.content}`,
							);
						}
					} else {
						result.errors.push(`Failed to delete non-matching ${recordType} record for ${recordName}: ${del.msg}`);
						result.failedRecords++;
					}
				}
			}
		}
	} catch (error) {
		if (context.verbose) {
			console.log(
				`${zoneProgress}   ⚠️  Could not pre-delete non-matching multi-records: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}
}

/**
 * Group MIAB records by name and type for conflict detection
 */
function groupMiabRecordsByNameAndType(records: DnsRecord[]): Map<string, DnsRecord[]> {
	const miabRecordGroups = new Map<string, DnsRecord[]>();

	for (const record of records) {
		const key = `${record.qname}|${record.rtype}`;
		if (!miabRecordGroups.has(key)) {
			miabRecordGroups.set(key, []);
		}
		const group = miabRecordGroups.get(key);
		if (group) {
			group.push(record);
		}
	}

	return miabRecordGroups;
}

/**
 * Analyze conflicts between MIAB and existing INWX records
 */
function analyzeRecordConflicts(
	miabRecordGroups: Map<string, DnsRecord[]>,
	existingRecords: unknown[],
): { totalConflicts: number; migrationConflicts: number; conflicts: ConflictDetails[] } {
	let totalConflicts = 0;
	let migrationConflicts = 0;
	const conflicts: ConflictDetails[] = [];

	for (const [key, miabRecords] of miabRecordGroups) {
		const [recordName, recordType] = key.split("|");

		const conflictingInwxRecords = findConflictingInwxRecords(existingRecords, recordName, recordType);

		if (conflictingInwxRecords.length > 0) {
			totalConflicts++;

			const hasContentConflict = checkForContentConflicts(miabRecords, conflictingInwxRecords);

			if (hasContentConflict) {
				migrationConflicts++;
				conflicts.push({
					recordName,
					recordType,
					miabRecords,
					conflictingInwxRecords,
				});
			}
		}
	}

	return { totalConflicts, migrationConflicts, conflicts };
}

/**
 * Find INWX records that conflict with a MIAB record
 */
function findConflictingInwxRecords(
	existingRecords: unknown[],
	recordName: string,
	recordType: string,
): Array<{ content?: string }> {
	return existingRecords.filter((inwxRecord: { name?: string; type?: string }) => {
		const normalizedInwxName = inwxRecord.name?.replace(/\.$/, "") || "";
		const normalizedMiabName = recordName.replace(/\.$/, "");
		return normalizedInwxName === normalizedMiabName && inwxRecord.type === recordType;
	}) as Array<{ content?: string }>;
}

/**
 * Check if MIAB records have content conflicts with existing INWX records
 */
function checkForContentConflicts(
	miabRecords: DnsRecord[],
	conflictingInwxRecords: Array<{ content?: string }>,
): boolean {
	for (const miabRecord of miabRecords) {
		const inwxContents = conflictingInwxRecords.map((r) => String(r.content || ""));

		if (miabRecord.rtype === "MX") {
			// Treat as matching if MX target equals (priority differences are not counted here)
			const { content } = parseMxRecord(miabRecord.value);
			const target = content.replace(/\.$/, "");
			const hasMatch = inwxContents.some((c) => c.replace(/\.$/, "") === target);
			if (hasMatch) {
				return false; // no content conflict
			}
			continue;
		}

		if (miabRecord.rtype === "SRV") {
			const { port, content } = parseSrvRecord(miabRecord.value);
			const target = content.replace(/\.$/, "");
			const hasSrvMatch = inwxContents.some((c) => {
				const parts = c.trim().split(/\s+/);
				if (parts.length >= 3) {
					const inwxPort = parseInt(parts[1], 10);
					const inwxTarget = parts.slice(2).join(" ").replace(/\.$/, "");
					return inwxPort === port && inwxTarget === target;
				}
				if (parts.length === 2) {
					const inwxPort = parseInt(parts[0], 10);
					const inwxTarget = parts[1].replace(/\.$/, "");
					return inwxPort === port && inwxTarget === target;
				}
				// If only target present (unlikely for SRV), compare target only
				return parts.length === 1 && parts[0].replace(/\.$/, "") === target;
			});
			if (hasSrvMatch) {
				return false; // no content conflict
			}
			continue;
		}

		const hasExactMatch = conflictingInwxRecords.some((inwxRecord) => {
			return doesRecordContentMatch(miabRecord, { content: inwxRecord.content || "" });
		});
		if (hasExactMatch) {
			return false; // no content conflict
		}
	}
	return true; // conflict remains
}

/**
 * Log migration conflicts to console and add warnings
 */
function logMigrationConflicts(
	analysis: { totalConflicts: number; migrationConflicts: number; conflicts: ConflictDetails[] },
	context: MigrationContext,
	zoneProgress: string,
	result: MigrationResult,
): void {
	const { totalConflicts, migrationConflicts, conflicts } = analysis;

	if (migrationConflicts > 0) {
		const warningMsg = `Found ${migrationConflicts} record types with migration conflicts (${totalConflicts} total name+type matches)`;
		result.warnings.push(warningMsg);

		if (context.verbose) {
			console.log(`${zoneProgress}   📊 Migration conflict summary: ${warningMsg}`);

			logDetailedConflicts(conflicts, zoneProgress);
			logConflictResolutionAdvice(context.conflictResolution || "skip", zoneProgress);
		}
	} else if (context.verbose && totalConflicts > 0) {
		console.log(
			`${zoneProgress}   ✅ Found ${totalConflicts} existing records with same names, but all have matching content`,
		);
	}
}

/**
 * Log detailed conflict information
 */
function logDetailedConflicts(conflicts: ConflictDetails[], zoneProgress: string): void {
	for (const conflict of conflicts) {
		console.log(`${zoneProgress}   ⚠️  Migration conflict detected: ${conflict.recordType} ${conflict.recordName}`);
		console.log(`${zoneProgress}       Existing INWX records: ${conflict.conflictingInwxRecords.length}`);
		console.log(`${zoneProgress}       MIAB records to migrate: ${conflict.miabRecords.length}`);

		logRecordExamples(conflict, zoneProgress);
	}
}

/**
 * Log examples of conflicting records
 */
function logRecordExamples(conflict: ConflictDetails, zoneProgress: string): void {
	const maxShow = 2;

	console.log(`${zoneProgress}       Existing INWX content:`);
	for (let i = 0; i < Math.min(maxShow, conflict.conflictingInwxRecords.length); i++) {
		console.log(`${zoneProgress}         - ${conflict.conflictingInwxRecords[i].content || ""}`);
	}
	if (conflict.conflictingInwxRecords.length > maxShow) {
		console.log(`${zoneProgress}         ... and ${conflict.conflictingInwxRecords.length - maxShow} more`);
	}

	console.log(`${zoneProgress}       New MIAB content:`);
	for (let i = 0; i < Math.min(maxShow, conflict.miabRecords.length); i++) {
		console.log(`${zoneProgress}         - ${conflict.miabRecords[i].value}`);
	}
	if (conflict.miabRecords.length > maxShow) {
		console.log(`${zoneProgress}         ... and ${conflict.miabRecords.length - maxShow} more`);
	}
}

/**
 * Log conflict resolution strategy advice
 */
function logConflictResolutionAdvice(strategy: string, zoneProgress: string): void {
	switch (strategy) {
		case "overwrite":
			console.log(
				`${zoneProgress}   💡 With --conflict-resolution=overwrite, existing records will be replaced with MIAB values.`,
			);
			break;
		case "interactive":
			console.log(
				`${zoneProgress}   💡 With --conflict-resolution=interactive, you'll be prompted for each conflicting record.`,
			);
			break;
		default:
			console.log(
				`${zoneProgress}   💡 With --conflict-resolution=skip (current), MIAB records will be skipped where conflicts exist.`,
			);
			console.log(
				`${zoneProgress}       For server migration, consider using --conflict-resolution=overwrite to replace old server records.`,
			);
			break;
	}
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
		const domainsResult = await getAllDomains(inwxClient);

		if (domainsResult.success && domainsResult.domains) {
			const isDomainRegistered = domainsResult.domains.includes(domain);

			if (!isDomainRegistered) {
				result.success = false;
				result.warnings.push(
					`No DNS zone found for ${domain} in INWX - create the zone manually if the domain is registered elsewhere`,
				);
				if (context.verbose) {
					console.log(
						`${zoneProgress}   ⚠️  No DNS zone found for ${domain} in INWX (domain may be registered elsewhere)`,
					);
					console.log(`${zoneProgress}      Available domains: ${domainsResult.domains.length} total`);
				}
			} else if (context.verbose) {
				console.log(`${zoneProgress}   ✅ Domain ${domain} is registered, can create DNS zone`);
			}
		} else {
			result.warnings.push(`Could not verify domain registration: ${domainsResult.error || "Unknown error"}`);
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
			handleDryRunRecord(record, result, context, zoneProgress);
			return;
		}

		const existingRecord = await findAndValidateExistingRecord(
			inwxClient,
			domain,
			record,
			result,
			context,
			zoneProgress,
		);
		if (existingRecord === false) {
			return; // Error already handled
		}

		if (existingRecord) {
			await handleExistingRecord(record, domain, existingRecord, inwxClient, context, zoneProgress, result);
			return;
		}

		// Record doesn't exist, create new one
		if (context.conflictResolution === "overwrite") {
			await deleteConflictingCnameIfNeeded(record, domain, inwxClient, context, zoneProgress, result);
		}
		await createNewRecord(record, domain, inwxClient, context, zoneProgress, result);
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
 * Handle dry run mode for a record
 */
function handleDryRunRecord(
	record: DnsRecord,
	result: MigrationResult,
	context: MigrationContext,
	zoneProgress: string,
): void {
	if (context.verbose) {
		console.log(`${zoneProgress}   [DRY RUN] Would create ${record.rtype} record: ${record.qname} -> ${record.value}`);
	}
	result.successfulRecords++;
}

/**
 * Find and validate existing record, handling errors appropriately
 */
async function findAndValidateExistingRecord(
	inwxClient: ApiClient,
	domain: string,
	record: DnsRecord,
	result: MigrationResult,
	context: MigrationContext,
	zoneProgress: string,
): Promise<ExistingInwxRecord | null | false> {
	const existingRecordResult = await findExistingInwxRecord(inwxClient, domain, record, {
		allowMulti: allowsMultipleRecords(record.rtype) && context.conflictResolution === "overwrite",
	});
	if (!existingRecordResult.success) {
		result.failedRecords++;
		result.errors.push(existingRecordResult.error);
		if (context.verbose) {
			console.error(`${zoneProgress}   ❌ ${existingRecordResult.error}`);
		}
		return false; // Indicates error
	}
	return existingRecordResult.data;
}

/**
 * Handle updating an existing record
 */
async function handleExistingRecord(
	record: DnsRecord,
	domain: string,
	existingRecord: ExistingInwxRecord,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
	result: MigrationResult,
): Promise<void> {
	const conflictResolution = context.conflictResolution || "skip";
	const action = await resolveRecordConflict(record, existingRecord, conflictResolution, zoneProgress, context.verbose);

	if (action === "skip") {
		result.skippedRecords++;
		if (context.verbose) {
			console.log(`${zoneProgress}   ⏭️  Skipped existing record: ${record.rtype} ${record.qname}`);
		}
		return;
	}

	if (action === "overwrite") {
		const updateResult = await updateInwxRecord(inwxClient, domain, existingRecord.id, record);
		if (updateResult.success) {
			result.updatedRecords++;
			result.successfulRecords++;
			if (context.verbose) {
				const displayValue = buildDisplayValue(record, domain);
				console.log(`${zoneProgress}   🔄 Updated ${record.rtype} record: ${record.qname} -> ${displayValue}`);
			}
		} else {
			result.failedRecords++;
			result.errors.push(updateResult.error);
			if (context.verbose) {
				console.error(`${zoneProgress}   ❌ Failed to update ${record.rtype} record: ${updateResult.error}`);
			}
		}
	}
}

/**
 * Build display value for logging
 */
function buildDisplayValue(record: DnsRecord, domain: string): string {
	let displayValue = record.value;
	if (record.rtype === "MX") {
		const params = buildRecordParams(record, domain);
		displayValue = `${params.prio} ${params.content}`;
	} else if (record.rtype === "SRV") {
		const { prio, weight, port, content } = parseSrvRecord(record.value);
		displayValue = `${prio} ${weight} ${port} ${content}`;
	}
	return displayValue;
}

/**
 * Create a new DNS record
 */
async function createNewRecord(
	record: DnsRecord,
	domain: string,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
	result: MigrationResult,
): Promise<void> {
	const recordParams = buildRecordParams(record, domain);

	// TXT singleton semantics and MTA-STS gating
	if (record.rtype === "TXT") {
		const normalizedName = record.qname.replace(/\.$/, "");
		const contentLc = record.value.trim().toLowerCase();

		const isMtaStsName = normalizedName === `_mta-sts.${domain}`;
		const isMtaStsContent = contentLc.startsWith("v=stsv1");
		const isDmarc = contentLc.startsWith("v=dmarc");
		const isSpf = contentLc.startsWith("v=spf1");
		const isGoogle = contentLc.startsWith("google-site-") || contentLc.startsWith("google-site-verification=");
		const isApple = contentLc.startsWith("apple-domain-verification=");
		const isFacebook =
			contentLc.startsWith("facebook-domain-verification=") || contentLc.startsWith("meta-domain-verification=");
		const isBing = contentLc.startsWith("msvalidate.") || contentLc.startsWith("bing-site-verification=");
		const isZoho = contentLc.startsWith("zoho-verification=");
		const isYandex = contentLc.startsWith("yandex-verification=");
		const isMailRu = contentLc.startsWith("mailru-domain=");
		const isCloudflare = contentLc.startsWith("ca3-");
		const isAtlassian = contentLc.startsWith("atlassian-domain-verification=");
		const isMS =
			contentLc.startsWith("MS=") || contentLc.startsWith("ms-site-validation=") || contentLc.startsWith("docusign=");

		// Gate MTA-STS TXT on successful policy reachability
		if (isMtaStsName || isMtaStsContent) {
			const ok = await isMtaStsPolicyReachable(domain);
			if (!ok) {
				result.skippedRecords++;
				result.warnings.push(
					`Skipping MTA-STS TXT for ${normalizedName}: policy not reachable at https://mta-sts.${domain}/.well-known/mta-sts.txt`,
				);
				if (context.verbose) {
					console.log(
						`${zoneProgress}   ⚠️  Skipping MTA-STS TXT; policy not reachable at https://mta-sts.${domain}/.well-known/mta-sts.txt`,
					);
				}
				return;
			}
		}

		// Remove conflicting TXT entries by semantic prefix for same name
		if (
			isMtaStsName ||
			isMtaStsContent ||
			isDmarc ||
			isSpf ||
			isGoogle ||
			isApple ||
			isFacebook ||
			isBing ||
			isZoho ||
			isYandex ||
			isMailRu ||
			isCloudflare ||
			isAtlassian ||
			isMS
		) {
			const prefixes = [
				...(isMtaStsName || isMtaStsContent ? ["v=stsv1", "v=stsv1; id="] : []),
				...(isDmarc ? ["v=dmarc"] : []),
				...(isSpf ? ["v=spf1"] : []),
				...(isGoogle ? ["google-site-", "google-site-verification="] : []),
				...(isApple ? ["apple-domain-verification="] : []),
				...(isFacebook ? ["facebook-domain-verification=", "meta-domain-verification="] : []),
				...(isBing ? ["msvalidate.", "bing-site-verification="] : []),
				...(isZoho ? ["zoho-verification="] : []),
				...(isYandex ? ["yandex-verification="] : []),
				...(isMailRu ? ["mailru-domain="] : []),
				...(isCloudflare ? ["ca3-"] : []),
				...(isAtlassian ? ["atlassian-domain-verification="] : []),
				...(isMS ? ["MS=", "ms-site-validation=", "docusign="] : []),
			];
			await deleteExistingTxtRecordsByPrefix(inwxClient, domain, normalizedName, prefixes, context, result);
		}
	}

	// Validate SRV records before creating
	if (record.rtype === "SRV") {
		const validationResult = validateSrvRecord(record, recordParams, context, zoneProgress);
		if (!validationResult.isValid) {
			result.failedRecords++;
			result.errors.push(validationResult.error);
			return;
		}
	}

	try {
		const createResponse = await createRecordWithRetry(record, domain, recordParams, inwxClient, context, zoneProgress);
		handleRecordCreationResponse(createResponse, record, recordParams, result, context, zoneProgress);
	} catch (error) {
		result.failedRecords++;
		const detailedError = `INWX API returned invalid JSON for ${record.rtype} record ${record.qname}. This might be a temporary API issue.`;
		result.errors.push(detailedError);

		if (context.verbose) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			console.error(
				`${zoneProgress}   ❌ JSON parsing error for ${record.rtype} record ${record.qname}: ${errorMessage}`,
			);
			// Condensed params output for readability
			console.error(`${zoneProgress}   Params:`, JSON.stringify(recordParams));
		}
	}
}

/**
 * Validate SRV record parameters and log debugging info
 */
function validateSrvRecord(
	record: DnsRecord,
	recordParams: Record<string, unknown>,
	context: MigrationContext,
	zoneProgress: string,
): { isValid: boolean; error: string } {
	// Validate SRV record parameters
	const validation = validateSrvRecordParams(recordParams, record);

	if (!validation.isValid) {
		const errorMsg = `Invalid SRV record parameters for ${record.qname}: ${validation.issues.join(", ")}`;
		if (context.verbose) {
			console.error(`${zoneProgress}   ❌ ${errorMsg}`);
			console.error(`${zoneProgress}   📝 Original value: "${record.value}"`);
			console.error(`${zoneProgress}   🔧 Parsed params:`, JSON.stringify(recordParams, null, 2));
		}
		return { isValid: false, error: errorMsg };
	}

	if (context.verbose) {
		// Condensed SRV debug: show only one essential line
		console.log(`${zoneProgress}   SRV params OK: ${record.qname} -> ${record.value}`);
	}

	return { isValid: true, error: "" };
}

/**
 * Create record with retry logic for SRV records
 */
async function createRecordWithRetry(
	record: DnsRecord,
	domain: string,
	recordParams: Record<string, unknown>,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
): Promise<{ code: number; msg: string }> {
	// Helper to strip domain suffix from qname for relative names
	const toRelativeName = (fullName: string, zoneDomain: string): string => {
		const suffix = `.${zoneDomain}`;
		return fullName.endsWith(suffix) ? fullName.slice(0, -suffix.length) : fullName;
	};
	if (record.rtype !== "SRV") {
		return await inwxClient.callApi("nameserver.createRecord", recordParams);
	}

	// SRV: use relative name + combined content "weight port target" (with trailing dot if given)
	const { prio, weight, port, content } = parseSrvRecord(record.value);
	const relativeName = toRelativeName(String(recordParams.name ?? record.qname), domain);
	const contentWithDot = typeof content === "string" && /\.$/.test(content) ? content : `${content}.`;
	const params = {
		domain,
		type: "SRV",
		name: relativeName,
		prio,
		content: `${weight} ${port} ${contentWithDot}`,
	};

	if (context.verbose) {
		console.log(`${zoneProgress}   SRV canonical: name=${params.name} prio=${params.prio} content="${params.content}"`);
	}

	return await inwxClient.callApi("nameserver.createRecord", params);
}

/**
 * Validate SRV record parameters before API call
 */
function validateSrvRecordParams(
	recordParams: Record<string, unknown>,
	_record: DnsRecord,
): { isValid: boolean; issues: string[] } {
	const issues: string[] = [];

	// Check required fields
	if (typeof recordParams.prio !== "number" || Number.isNaN(recordParams.prio as number)) {
		issues.push(`Invalid priority: ${recordParams.prio} (type: ${typeof recordParams.prio})`);
	}

	if (typeof recordParams.weight !== "number" || Number.isNaN(recordParams.weight as number)) {
		issues.push(`Invalid weight: ${recordParams.weight} (type: ${typeof recordParams.weight})`);
	}

	if (typeof recordParams.port !== "number" || Number.isNaN(recordParams.port as number)) {
		issues.push(`Invalid port: ${recordParams.port} (type: ${typeof recordParams.port})`);
	}

	if (
		!recordParams.content ||
		typeof recordParams.content !== "string" ||
		(recordParams.content as string).trim().length === 0
	) {
		issues.push(`Invalid content: "${recordParams.content}" (type: ${typeof recordParams.content})`);
	}

	// Check for reasonable value ranges
	const prio = recordParams.prio as number;
	const weight = recordParams.weight as number;
	const port = recordParams.port as number;

	if (!Number.isNaN(prio) && (prio < 0 || prio > 65535)) {
		issues.push(`Priority out of range: ${prio} (should be 0-65535)`);
	}

	if (!Number.isNaN(weight) && (weight < 0 || weight > 65535)) {
		issues.push(`Weight out of range: ${weight} (should be 0-65535)`);
	}

	if (!Number.isNaN(port) && (port < 0 || port > 65535)) {
		issues.push(`Port out of range: ${port} (should be 0-65535)`);
	}

	// Check for problematic content patterns
	const content = recordParams.content as string;
	if (content && typeof content === "string") {
		if (content.includes("\n") || content.includes("\r")) {
			issues.push(`Content contains line breaks: "${content}"`);
		}

		if (content.includes("\t")) {
			issues.push(`Content contains tabs: "${content}"`);
		}

		// Check for unusual characters that might cause API issues
		if (!/^[a-zA-Z0-9.-]+$/.test(content)) {
			issues.push(`Content contains unusual characters: "${content}"`);
		}
	}

	return {
		isValid: issues.length === 0,
		issues,
	};
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
	} else if (record.rtype === "SRV") {
		const { prio, weight, port, content } = parseSrvRecord(record.value);
		params.prio = prio;
		params.weight = weight;
		params.port = port;
		params.content = content;
	} else if (record.rtype === "SSHFP") {
		params.content = cleanSshfpRecord(record.value);
	} else {
		params.content = record.value;
	}

	return params;
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
			let displayValue = record.value;
			if (record.rtype === "MX") {
				displayValue = `${recordParams.prio} ${recordParams.content}`;
			} else if (record.rtype === "SRV") {
				displayValue = `${recordParams.prio} ${recordParams.weight} ${recordParams.port} ${recordParams.content}`;
			}
			console.log(`${zoneProgress}   ✅ Created ${record.rtype} record: ${record.qname} -> ${displayValue}`);
		}
	} else if (response.code === INWX_RECORD_EXISTS_CODE) {
		result.successfulRecords++;
		if (context.verbose) {
			let displayValue = record.value;
			if (record.rtype === "MX") {
				displayValue = `${recordParams.prio} ${recordParams.content}`;
			} else if (record.rtype === "SRV") {
				displayValue = `${recordParams.prio} ${recordParams.weight} ${recordParams.port} ${recordParams.content}`;
			}
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
 * Purge existing records in a zone (except SOA and NS)
 */
async function purgeExistingZoneRecords(
	domain: string,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
): Promise<{ success: boolean; errors: string[]; warnings: string[] }> {
	const outcome = { success: true, errors: [] as string[], warnings: [] as string[] };

	try {
		if (context.dryRun) {
			if (context.verbose) {
				console.log(`${zoneProgress}   [DRY RUN] Would purge existing records for ${domain} (keep SOA/NS)`);
			}
			outcome.warnings.push(`Zone ${domain} would be purged (SOA/NS preserved)`);
			return outcome;
		}

		const info = await inwxClient.callApi("nameserver.info", { domain });
		if (info.code !== INWX_SUCCESS_CODE) {
			outcome.success = false;
			outcome.errors.push(`Failed to fetch records for purge: ${info.msg}`);
			return outcome;
		}

		const records = info.resData?.record || [];
		const toDelete = records.filter((r: { type?: string }) => r.type !== "SOA" && r.type !== "NS");

		for (const rec of toDelete) {
			if (!rec.id) continue;
			const resp = await inwxClient.callApi("nameserver.deleteRecord", { id: rec.id });
			if (resp.code !== INWX_SUCCESS_CODE) {
				outcome.success = false;
				outcome.errors.push(`Failed to delete record ${rec.type} ${rec.name}: ${resp.msg}`);
			}
		}

		if (context.verbose) {
			console.log(`${zoneProgress}   🧹 Purged ${toDelete.length} records in ${domain} (SOA/NS kept)`);
		}
	} catch (error) {
		outcome.success = false;
		outcome.errors.push(
			`Error purging records for ${domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return outcome;
}

/**
 * Delete conflicting CNAME when creating MX (or other non-CNAME) in overwrite mode
 */
async function deleteConflictingCnameIfNeeded(
	record: DnsRecord,
	domain: string,
	inwxClient: ApiClient,
	context: MigrationContext,
	zoneProgress: string,
	result: MigrationResult,
): Promise<void> {
	try {
		// Only relevant when creating an MX or other non-CNAME record
		if (record.rtype === "CNAME") return;

		const info = await inwxClient.callApi("nameserver.info", { domain });
		if (info.code !== INWX_SUCCESS_CODE) return;

		const cname = (info.resData?.record || []).find(
			(r: { name?: string; type?: string }) =>
				(r.name || "").replace(/\.$/, "") === record.qname.replace(/\.$/, "") && r.type === "CNAME",
		);

		if (!cname) return;

		if (context.dryRun) {
			if (context.verbose) {
				console.log(
					`${zoneProgress}   [DRY RUN] Would delete conflicting CNAME before creating ${record.rtype} ${record.qname}`,
				);
			}
			result.warnings.push(`Would delete conflicting CNAME for ${record.qname}`);
			return;
		}

		const del = await inwxClient.callApi("nameserver.deleteRecord", { id: cname.id });
		if (del.code === INWX_SUCCESS_CODE) {
			if (context.verbose) {
				console.log(`${zoneProgress}   🧹 Deleted conflicting CNAME for ${record.qname}`);
			}
		} else {
			result.errors.push(`Failed to delete conflicting CNAME for ${record.qname}: ${del.msg}`);
			result.failedRecords++;
		}
	} catch (error) {
		result.errors.push(
			`Error deleting conflicting CNAME for ${record.qname}: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		result.failedRecords++;
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

/**
 * Fetch text via HTTPS with timeout
 */
async function fetchText(url: string, timeoutMs = 5000): Promise<{ status: number; body: string }> {
	return await new Promise((resolve, reject) => {
		const urlObj = new URL(url);
		const req = httpsRequest(
			{
				hostname: urlObj.hostname,
				path: urlObj.pathname + urlObj.search,
				method: "GET",
				headers: { Accept: "text/plain" },
			},
			(res) => {
				let data = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					data += String(chunk);
				});
				res.on("end", () => {
					resolve({ status: res.statusCode || 0, body: data });
				});
			},
		);
		const timer = setTimeout(() => {
			req.destroy(new Error("Request timeout"));
			reject(new Error("Request timeout"));
		}, timeoutMs);
		req.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		req.on("close", () => {
			clearTimeout(timer);
		});
		req.end();
	});
}

/**
 * Check MTA-STS policy reachability (200-399 and contains version: STSv1)
 */
async function isMtaStsPolicyReachable(domain: string): Promise<boolean> {
	try {
		const url = `https://mta-sts.${domain}/.well-known/mta-sts.txt`;
		const { status, body } = await fetchText(url, 5000);
		return status >= 200 && status < 400 && /version:\s*STSv1/i.test(body);
	} catch {
		return false;
	}
}

/**
 * Delete existing TXT records with matching semantic prefixes for the same name
 */
async function deleteExistingTxtRecordsByPrefix(
	inwxClient: ApiClient,
	domain: string,
	name: string,
	prefixes: string[],
	context: MigrationContext,
	result: MigrationResult,
): Promise<void> {
	const info = await inwxClient.callApi("nameserver.info", { domain });
	if (info.code !== INWX_SUCCESS_CODE) return;
	const records = info.resData?.record || [];
	const toDelete = records.filter(
		(r: { id?: string; type?: string; name?: string; content?: string }) =>
			r.type === "TXT" &&
			(r.name || "").replace(/\.$/, "") === name &&
			prefixes.some((p) => (r.content || "").toLowerCase().startsWith(p)),
	);

	for (const rec of toDelete) {
		if (!rec.id) continue;
		if (context.dryRun) {
			result.warnings.push(`Would delete existing TXT for ${name} with prefix match`);
			continue;
		}
		const del = await inwxClient.callApi("nameserver.deleteRecord", { id: rec.id });
		if (del.code !== INWX_SUCCESS_CODE) {
			result.errors.push(`Failed to delete TXT ${name}: ${del.msg}`);
			result.failedRecords++;
		}
	}
}

/**
 * Check if MTA-STS policy is published and reachable
 */
async function checkMtaStsPolicyAvailability(
	zone: DnsZone,
	context: MigrationContext,
	zoneProgress: string,
	result: MigrationResult,
): Promise<void> {
	try {
		const domain = zone.domain;
		const hasMtaStsTxt = zone.records.some(
			(r) => r.rtype === "TXT" && r.qname.replace(/\.$/, "") === `_mta-sts.${domain}`,
		);
		if (!hasMtaStsTxt) return;

		const policyUrl = `https://mta-sts.${domain}/.well-known/mta-sts.txt`;
		const { status, body } = await fetchText(policyUrl, 5000);
		const ok = status >= 200 && status < 400 && /version:\s*STSv1/i.test(body);
		if (!ok) {
			result.warnings.push(`MTA-STS policy not reachable/valid at ${policyUrl} (status ${status})`);
			if (context.verbose) {
				console.log(`${zoneProgress}   ⚠️  MTA-STS policy missing or invalid at ${policyUrl} (status ${status})`);
			}
		} else if (context.verbose) {
			console.log(`${zoneProgress}   ✅ MTA-STS policy reachable at ${policyUrl}`);
		}
	} catch (err) {
		result.warnings.push(`MTA-STS policy check failed: ${(err as Error).message}`);
	}
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

function logMigrationOverview(
	allZones: DnsZone[],
	filteredZones: DnsZone[],
	include: string[],
	exclude: string[],
	environmentName: string,
	dryRun: boolean,
): void {
	const totalRecords = allZones.reduce((sum, zone) => sum + zone.records.length, 0);
	const filteredRecords = filteredZones.reduce((sum, zone) => sum + zone.records.length, 0);

	console.log(`📋 Migration Overview:`);
	console.log(`  Total DNS Zones Found: ${allZones.length}`);
	console.log(`  DNS Zones to Migrate: ${filteredZones.length}`);
	console.log(`  Total DNS Records Found: ${totalRecords}`);
	console.log(`  DNS Records to Migrate: ${filteredRecords}`);
	console.log(`  Target Environment: INWX ${environmentName}`);
	console.log(`  Included Patterns: ${include.join(", ")}`);
	if (exclude.length > 0) {
		console.log(`  Excluded Patterns: ${exclude.join(", ")}`);
	}

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
