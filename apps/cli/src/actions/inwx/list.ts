import type { CommandResult } from "../../types/index.ts";
import type { InwxListData, InwxListOptions } from "../../types/inwx-list.ts";
import type { DnsZone } from "../../types/migrate-dns.ts";
import { cleanupInwxClient, createInwxClient, fetchInwxDnsZones, testInwxConnection } from "../../utils/dns.ts";

/**
 * List DNS records from INWX
 */
export async function listInwxDns(options: InwxListOptions): Promise<CommandResult<InwxListData>> {
	try {
		const { username, password, sharedSecret, environment = "ote", verbose, filter, zone } = options;

		// Validate required parameters
		if (!username || !password) {
			return {
				success: false,
				error: "Missing required INWX connection parameters: username, password",
			};
		}

		if (verbose) {
			console.log(`Fetching DNS records from INWX ${environment.toUpperCase()} environment...`);
			if (zone) {
				console.log(`Filtering for zone: ${zone}`);
			}
			if (filter) {
				console.log(`Applying filter: ${filter}`);
			}
		}

		// Initialize INWX API client
		const { client, environmentInfo } = createInwxClient({
			username,
			password,
			sharedSecret,
			environment,
			verbose,
		});

		// Test connection
		const connectionResult = await testInwxConnection(client, {
			username,
			password,
			sharedSecret,
			environment,
			verbose,
		});

		if (!connectionResult.success) {
			return {
				success: false,
				error: connectionResult.error,
			};
		}

		// Fetch DNS zones from INWX
		const result = await fetchInwxDnsZones(client, verbose);

		if (!result.success) {
			await cleanupInwxClient(client);
			return {
				success: false,
				error: result.error,
			};
		}

		let zones = result.data || [];

		// Apply zone filter if specified
		if (zone) {
			zones = zones.filter((z) => z.domain === zone || z.domain.includes(zone));
		}

		// Apply record filter if specified
		if (filter) {
			zones = applyDnsFilter(zones, filter);
		}

		const totalRecords = zones.reduce((sum, z) => sum + z.records.length, 0);

		if (verbose) {
			console.log(`Found ${zones.length} zones with ${totalRecords} total records`);
		}

		// Cleanup connection
		await cleanupInwxClient(client);

		return {
			success: true,
			message: `Successfully retrieved ${zones.length} DNS zones with ${totalRecords} records`,
			data: {
				connection: {
					username,
					environment,
					apiUrl: environmentInfo.apiUrl,
					authenticated: true,
				},
				zones,
				totalZones: zones.length,
				totalRecords,
				timestamp: new Date().toISOString(),
			},
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to list DNS records",
		};
	}
}

/**
 * Apply text filter to DNS zones and records
 */
function applyDnsFilter(zones: DnsZone[], filter: string): DnsZone[] {
	const filterLower = filter.toLowerCase();
	const filteredZones: DnsZone[] = [];

	for (const zone of zones) {
		// Check if zone domain matches filter
		const domainMatches = zone.domain.toLowerCase().includes(filterLower);

		// Filter records that match the filter
		const filteredRecords = zone.records.filter(
			(record) =>
				record.qname.toLowerCase().includes(filterLower) ||
				record.rtype.toLowerCase().includes(filterLower) ||
				record.value.toLowerCase().includes(filterLower) ||
				record.explanation?.toLowerCase().includes(filterLower),
		);

		// Include zone if domain matches or if it has matching records
		if (domainMatches || filteredRecords.length > 0) {
			filteredZones.push({
				domain: zone.domain,
				records: domainMatches ? zone.records : filteredRecords,
			});
		}
	}

	return filteredZones;
}
