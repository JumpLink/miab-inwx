import { MiabClient } from "@miab-inwx/miab-client";
import { ApiClient, Language } from "domrobot-client";
import type { CommandResult } from "../../types/index.ts";
import type {
	DnsRecord,
	DnsZone,
	MigrateDnsData,
	MigrateDnsOptions,
	MigrationResult,
} from "../../types/migrate-dns.ts";

/**
 * Migrate DNS records from MIAB to INWX
 */
export async function migrateDnsRecords(options: MigrateDnsOptions): Promise<CommandResult<MigrateDnsData>> {
	try {
		const { miab, inwx, dryRun = false, force = false } = options;

		// Validate required parameters
		if (!miab.apiUrl || !miab.email || !miab.password) {
			return {
				success: false,
				error: "Missing required MIAB connection parameters: apiUrl, email, password",
			};
		}

		if (!inwx.username || !inwx.password) {
			return {
				success: false,
				error: "Missing required INWX connection parameters: username, password",
			};
		}

		const environment = inwx.environment || "ote";
		const isOte = environment === "ote";
		const inwxApiUrl = isOte ? ApiClient.API_URL_OTE : ApiClient.API_URL_LIVE;
		const environmentName = isOte ? "OTE (Test)" : "Live (Production)";

		if (miab.verbose) {
			console.log(`Starting DNS migration from MIAB to INWX ${environmentName} environment...`);
			if (dryRun) {
				console.log("DRY RUN MODE: No actual changes will be made");
			}
		}

		// Initialize API clients
		const miabAuth = `${miab.email}:${miab.password}`;
		const inwxApiClient = new ApiClient(inwxApiUrl, Language.EN, inwx.verbose);

		// Test MIAB connection
		let miabZones: string[] = [];
		try {
			const miabZonesResponse = await MiabClient.getDnsZones({
				baseUrl: miab.apiUrl,
				auth: miabAuth,
				throwOnError: true,
			});

			if (!miabZonesResponse.data || !Array.isArray(miabZonesResponse.data)) {
				return {
					success: false,
					error: "Invalid response from MIAB API when fetching DNS zones",
				};
			}

			miabZones = miabZonesResponse.data;

			if (miab.verbose) {
				console.log(`Found ${miabZones.length} DNS zones in MIAB`);
			}
		} catch (miabError) {
			return {
				success: false,
				error: `Failed to connect to MIAB API: ${miabError instanceof Error ? miabError.message : "Unknown error"}`,
			};
		}

		// Test INWX connection
		try {
			const inwxLoginResponse = await inwxApiClient.login(inwx.username, inwx.password, inwx.sharedSecret);

			if (inwxLoginResponse.code !== 1000) {
				return {
					success: false,
					error: `INWX authentication failed (Code: ${inwxLoginResponse.code}): ${inwxLoginResponse.msg}`,
				};
			}

			if (inwx.verbose) {
				console.log("Successfully authenticated with INWX API");
			}
		} catch (inwxError) {
			return {
				success: false,
				error: `Failed to connect to INWX API: ${inwxError instanceof Error ? inwxError.message : "Unknown error"}`,
			};
		}

		// Get all DNS records from MIAB
		let dnsZones: DnsZone[] = [];
		try {
			const miabDumpResponse = await MiabClient.getDnsDump({
				baseUrl: miab.apiUrl,
				auth: miabAuth,
				throwOnError: true,
			});

			if (!miabDumpResponse.data || !Array.isArray(miabDumpResponse.data)) {
				return {
					success: false,
					error: "Invalid response from MIAB API when fetching DNS dump",
				};
			}

			// Parse the DNS dump into zones
			dnsZones = parseMiabDnsDump(miabDumpResponse.data);
			const totalRecords = dnsZones.reduce((sum, zone) => sum + zone.records.length, 0);

			console.log(`📋 Migration Overview:`);
			console.log(`  Total DNS Zones: ${dnsZones.length}`);
			console.log(`  Total DNS Records: ${totalRecords}`);
			console.log(`  Target Environment: INWX ${environmentName}`);

			if (dryRun) {
				console.log(`  Mode: DRY RUN (no changes will be made)`);
			} else {
				const modeText = isOte ? "LIVE MIGRATION (TEST ENVIRONMENT)" : "LIVE MIGRATION (PRODUCTION ENVIRONMENT)";
				console.log(`  Mode: ${modeText}`);
			}
			console.log("");

			if (miab.verbose) {
				console.log(`Parsed ${dnsZones.length} DNS zones with ${totalRecords} total records`);
			}
		} catch (error) {
			return {
				success: false,
				error: `Failed to fetch DNS records from MIAB: ${error instanceof Error ? error.message : "Unknown error"}`,
			};
		}

		// Migrate each zone
		const migrationResults: MigrationResult[] = [];
		let totalProcessedZones = 0;
		let totalSuccessfulZones = 0;
		let totalFailedZones = 0;
		const startTime = Date.now();

		console.log("🚀 Starting zone migration...\n");

		for (let i = 0; i < dnsZones.length; i++) {
			const zone = dnsZones[i];
			const zoneProgress = `[${i + 1}/${dnsZones.length}]`;

			console.log(`${zoneProgress} 🌐 Processing zone: ${zone.domain} (${zone.records.length} records)`);

			if (miab.verbose) {
				console.log(`Processing zone: ${zone.domain}`);
			}

			const zoneResult = await migrateZone(zone, inwxApiClient, dryRun, force, miab.verbose, zoneProgress);
			migrationResults.push(zoneResult);

			totalProcessedZones++;
			if (zoneResult.failedRecords === 0) {
				totalSuccessfulZones++;
				console.log(
					`${zoneProgress} ✅ Zone ${zone.domain}: ${zoneResult.successfulRecords}/${zoneResult.totalRecords} records ${dryRun ? "verified" : "migrated"}`,
				);
			} else {
				totalFailedZones++;
				console.log(
					`${zoneProgress} ❌ Zone ${zone.domain}: ${zoneResult.successfulRecords}/${zoneResult.totalRecords} records successful, ${zoneResult.failedRecords} failed`,
				);
				if (zoneResult.errors.length > 0) {
					console.log(
						`${zoneProgress}    Errors: ${zoneResult.errors.slice(0, 3).join(", ")}${zoneResult.errors.length > 3 ? "..." : ""}`,
					);
				}
			}

			// Show overall progress every 5 zones or at the end
			if ((i + 1) % 5 === 0 || i === dnsZones.length - 1) {
				const processedRecords = migrationResults.reduce((sum, result) => sum + result.successfulRecords, 0);
				const totalPossibleRecords = migrationResults.reduce((sum, result) => sum + result.totalRecords, 0);
				const progressPercent = Math.round(((i + 1) / dnsZones.length) * 100);
				const elapsedTime = Math.round((Date.now() - startTime) / 1000);

				console.log(
					`📊 Progress: ${progressPercent}% complete (${i + 1}/${dnsZones.length} zones, ${processedRecords}/${totalPossibleRecords} records, ${elapsedTime}s elapsed)\n`,
				);
			}

			if (miab.verbose) {
				console.log(
					`Zone ${zone.domain}: ${zoneResult.successfulRecords}/${zoneResult.totalRecords} records migrated successfully`,
				);
			}
		}

		const totalElapsedTime = Math.round((Date.now() - startTime) / 1000);
		console.log(`🎉 Migration completed in ${totalElapsedTime} seconds!`);
		console.log(`   Zones: ${totalSuccessfulZones}/${totalProcessedZones} successful`);
		console.log(
			`   Records: ${migrationResults.reduce((sum, result) => sum + result.successfulRecords, 0)}/${migrationResults.reduce((sum, result) => sum + result.totalRecords, 0)} successful`,
		);
		console.log("");

		// Logout from INWX
		try {
			await inwxApiClient.logout();
		} catch (_error) {
			// Ignore logout errors
		}

		return {
			success: true,
			message: `DNS migration completed: ${totalSuccessfulZones}/${totalProcessedZones} zones migrated successfully`,
			data: {
				miab: {
					baseUrl: miab.apiUrl,
					username: miab.email,
					authenticated: true,
					zones: miabZones,
				},
				inwx: {
					username: inwx.username,
					environment,
					apiUrl: inwxApiUrl,
					authenticated: true,
				},
				migration: {
					dryRun,
					force,
					results: migrationResults,
					totalZones: dnsZones.length,
					processedZones: totalProcessedZones,
					successfulZones: totalSuccessfulZones,
					failedZones: totalFailedZones,
					timestamp: new Date().toISOString(),
				},
			},
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "DNS migration failed",
		};
	}
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
			if (
				typeof record === "object" &&
				record !== null &&
				"qname" in record &&
				"rtype" in record &&
				"value" in record
			) {
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
 * Migrate a single DNS zone
 */
async function migrateZone(
	zone: DnsZone,
	inwxApiClient: ApiClient,
	dryRun: boolean,
	_force: boolean,
	verbose?: boolean,
	zoneProgress?: string,
): Promise<MigrationResult> {
	const result: MigrationResult = {
		zone: zone.domain,
		totalRecords: zone.records.length,
		processedRecords: 0,
		successfulRecords: 0,
		failedRecords: 0,
		errors: [],
		warnings: [],
	};

	// Step 1: Check if DNS zone exists in INWX
	let zoneExists = false;
	try {
		if (dryRun) {
			if (verbose) {
				console.log(`${zoneProgress || ""}   [DRY RUN] Would check if DNS zone ${zone.domain} exists`);
			}
			// In dry run mode, assume zone doesn't exist to show the creation step
			zoneExists = false;
		} else {
			const zoneInfoResponse = await inwxApiClient.callApi("nameserver.info", {
				domain: zone.domain,
			});

			if (zoneInfoResponse.code === 1000) {
				zoneExists = true;
				if (verbose) {
					console.log(`${zoneProgress || ""}   ✅ DNS zone ${zone.domain} already exists`);
				}
			} else if (zoneInfoResponse.code === 2303) {
				// Zone doesn't exist - this is expected for new zones
				zoneExists = false;
				if (verbose) {
					console.log(`${zoneProgress || ""}   ℹ️  DNS zone ${zone.domain} does not exist, will create it`);
				}
			} else {
				// Unexpected error
				result.errors.push(`Failed to check DNS zone ${zone.domain}: ${zoneInfoResponse.msg}`);
				if (verbose) {
					console.error(`${zoneProgress || ""}   ❌ Failed to check DNS zone ${zone.domain}: ${zoneInfoResponse.msg}`);
				}
				return result;
			}
		}
	} catch (error) {
		result.errors.push(
			`Error checking DNS zone ${zone.domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		if (verbose) {
			console.error(
				`${zoneProgress || ""}   ❌ Error checking DNS zone ${zone.domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
		return result;
	}

	// Step 2: Create DNS zone if it doesn't exist
	if (!zoneExists) {
		try {
			if (dryRun) {
				if (verbose) {
					console.log(`${zoneProgress || ""}   [DRY RUN] Would create DNS zone ${zone.domain}`);
				}
				result.warnings.push(`DNS zone ${zone.domain} would be created`);
			} else {
				const createZoneResponse = await inwxApiClient.callApi("nameserver.create", {
					domain: zone.domain,
					type: "MASTER",
				});

				if (createZoneResponse.code === 1000) {
					if (verbose) {
						console.log(`${zoneProgress || ""}   ✅ Created DNS zone ${zone.domain}`);
					}
					result.warnings.push(`DNS zone ${zone.domain} was created`);
				} else {
					result.errors.push(`Failed to create DNS zone ${zone.domain}: ${createZoneResponse.msg}`);
					if (verbose) {
						console.error(
							`${zoneProgress || ""}   ❌ Failed to create DNS zone ${zone.domain}: ${createZoneResponse.msg}`,
						);
					}
					return result;
				}
			}
		} catch (error) {
			result.errors.push(
				`Error creating DNS zone ${zone.domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
			if (verbose) {
				console.error(
					`${zoneProgress || ""}   ❌ Error creating DNS zone ${zone.domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
			return result;
		}
	}

	// Step 3: Create DNS records
	// Show record-level progress for zones with many records
	const showRecordProgress = zone.records.length >= 10;
	const recordProgressThreshold = Math.max(1, Math.floor(zone.records.length / 10)); // Show progress every 10%

	for (let i = 0; i < zone.records.length; i++) {
		const record = zone.records[i];
		result.processedRecords++;

		// Show progress for large zones
		if (showRecordProgress && verbose && (i + 1) % recordProgressThreshold === 0) {
			const recordProgress = Math.round(((i + 1) / zone.records.length) * 100);
			console.log(`${zoneProgress || ""}   📄 Record progress: ${recordProgress}% (${i + 1}/${zone.records.length})`);
		}

		try {
			if (dryRun) {
				if (verbose) {
					console.log(
						`${zoneProgress || ""}   [DRY RUN] Would create ${record.rtype} record: ${record.qname} -> ${record.value}`,
					);
				}
				result.successfulRecords++;
			} else {
				// Create DNS record in INWX
				const createResponse = await inwxApiClient.callApi("nameserver.createRecord", {
					domain: zone.domain,
					type: record.rtype,
					name: record.qname,
					content: record.value,
				});

				if (createResponse.code === 1000) {
					result.successfulRecords++;
					if (verbose) {
						console.log(
							`${zoneProgress || ""}   ✅ Created ${record.rtype} record: ${record.qname} -> ${record.value}`,
						);
					}
				} else {
					result.failedRecords++;
					const errorMsg = `Failed to create ${record.rtype} record ${record.qname}: ${createResponse.msg}`;
					result.errors.push(errorMsg);
					if (verbose) {
						console.error(`${zoneProgress || ""}   ❌ ${errorMsg}`);
					}
				}
			}
		} catch (error) {
			result.failedRecords++;
			const errorMsg = `Error creating ${record.rtype} record ${record.qname}: ${error instanceof Error ? error.message : "Unknown error"}`;
			result.errors.push(errorMsg);
			if (verbose) {
				console.error(`${zoneProgress || ""}   ❌ ${errorMsg}`);
			}
		}

		// Add a small delay to prevent overwhelming the API (only in live mode)
		if (!dryRun && zone.records.length > 50) {
			await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms delay for large zones
		}
	}

	// Show completion for large zones
	if (showRecordProgress && (verbose || result.failedRecords > 0)) {
		const successRate = Math.round((result.successfulRecords / result.totalRecords) * 100);
		console.log(
			`${zoneProgress || ""}   📄 Zone completed: ${successRate}% success rate (${result.successfulRecords}/${result.totalRecords} records)`,
		);

		if (result.failedRecords > 0) {
			console.log(`${zoneProgress || ""}   ⚠️  ${result.failedRecords} records failed in this zone`);
		}
	}

	return result;
}
