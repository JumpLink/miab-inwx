import { ApiClient, Language } from "domrobot-client";
import type { CommandResult, InwxCheckDuplicatesData, InwxCheckDuplicatesOptions } from "../../types/index.ts";
import { INWX_SUCCESS_CODE } from "../../utils/constants.ts";
import { detectProblematicDuplicates } from "../../utils/dns-helpers.ts";
import { getAllDomains } from "../../utils/inwx-helpers.ts";

/**
 * Check for problematic duplicate DNS records in INWX zones
 */
export async function checkInwxDuplicates(
	options: InwxCheckDuplicatesOptions,
): Promise<CommandResult<InwxCheckDuplicatesData>> {
	try {
		const { username, password, sharedSecret, environment = "ote", verbose = false } = options;
		const apiUrl = environment === "ote" ? ApiClient.API_URL_OTE : ApiClient.API_URL_LIVE;

		if (!username || !password) {
			return {
				success: false,
				error: "Missing required INWX connection parameters: username, password",
			};
		}

		const client = new ApiClient(apiUrl, Language.EN, verbose);

		// Authenticate
		const loginResponse = await client.login(username, password, sharedSecret);
		if (loginResponse.code !== INWX_SUCCESS_CODE) {
			return {
				success: false,
				error: `INWX authentication failed (Code: ${loginResponse.code}): ${loginResponse.msg}`,
			};
		}

		const duplicatesByZone: Array<{
			domain: string;
			duplicates: Array<{
				name: string;
				type: string;
				records: Array<{
					id: string;
					content: string;
					ttl?: number;
				}>;
				reason: string;
			}>;
		}> = [];

		// Get list of zones to check
		let zonesToCheck: string[];
		if (options.domains && options.domains.length > 0) {
			zonesToCheck = options.domains;
		} else {
			// Get all domains from account using pagination
			const domainsResult = await getAllDomains(client);
			if (!domainsResult.success || !domainsResult.domains) {
				await client.logout();
				return {
					success: false,
					error: domainsResult.error || "Failed to list domains",
				};
			}

			zonesToCheck = domainsResult.domains;
		}

		if (verbose) {
			console.log(`🔍 Checking ${zonesToCheck.length} zones for problematic duplicates...`);
		}

		let totalDuplicates = 0;
		let zonesWithDuplicates = 0;

		// Check each zone
		for (const domain of zonesToCheck) {
			if (verbose) {
				console.log(`📋 Checking zone: ${domain}`);
			}

			try {
				const recordsResponse = await client.callApi("nameserver.info", { domain });

				if (recordsResponse.code !== INWX_SUCCESS_CODE) {
					if (verbose) {
						console.log(`   ⚠️  Could not fetch records for ${domain}: ${recordsResponse.msg}`);
					}
					continue;
				}

				const records = recordsResponse.resData?.record || [];
				const problematicDuplicates = detectProblematicDuplicates(records);

				if (problematicDuplicates.length > 0) {
					zonesWithDuplicates++;
					totalDuplicates += problematicDuplicates.length;

					duplicatesByZone.push({
						domain,
						duplicates: problematicDuplicates.map((dup) => ({
							name: dup.name,
							type: dup.type,
							records: dup.records.map((r) => ({
								id: r.id,
								content: r.content,
								ttl: r.ttl,
							})),
							reason: dup.reason,
						})),
					});

					if (verbose) {
						console.log(`   ❌ Found ${problematicDuplicates.length} duplicate issues:`);
						for (const duplicate of problematicDuplicates) {
							console.log(`      • ${duplicate.type} ${duplicate.name}: ${duplicate.reason}`);
							for (const record of duplicate.records) {
								console.log(`        - ${record.content} (ID: ${record.id})`);
							}
						}
					}
				} else if (verbose) {
					console.log(`   ✅ No problematic duplicates found`);
				}
			} catch (error) {
				if (verbose) {
					console.log(`   ⚠️  Error checking ${domain}: ${error instanceof Error ? error.message : "Unknown error"}`);
				}
			}
		}

		await client.logout();

		const summary = {
			totalZonesChecked: zonesToCheck.length,
			zonesWithDuplicates,
			totalDuplicateIssues: totalDuplicates,
			duplicatesByZone,
		};

		if (verbose) {
			console.log(`\n📊 Summary:`);
			console.log(`   Zones checked: ${summary.totalZonesChecked}`);
			console.log(`   Zones with duplicates: ${summary.zonesWithDuplicates}`);
			console.log(`   Total duplicate issues: ${summary.totalDuplicateIssues}`);
		}

		return {
			success: true,
			message: `Checked ${summary.totalZonesChecked} zones, found ${summary.totalDuplicateIssues} duplicate issues in ${summary.zonesWithDuplicates} zones`,
			data: {
				inwx: {
					username,
					environment,
					authenticated: true,
				},
				duplicates: summary,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: `Failed to check duplicates: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}
