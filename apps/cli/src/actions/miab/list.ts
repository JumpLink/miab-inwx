import type { CommandResult } from "../../types/index.ts";
import type { MiabListData, MiabListOptions } from "../../types/miab-list.ts";
import type { DnsZone } from "../../types/migrate-dns.ts";
import { fetchMiabDnsZones } from "../../utils/dns.ts";

/**
 * List DNS records from MIAB
 */
export async function listMiabDns(options: MiabListOptions): Promise<CommandResult<MiabListData>> {
	try {
		const { apiUrl, email, password, verbose, filter, zone } = options;

		// Validate required parameters
		if (!apiUrl || !email || !password) {
			return {
				success: false,
				error: "Missing required MIAB connection parameters: apiUrl, email, password",
			};
		}

		const auth = `${email}:${password}`;

		if (verbose) {
			console.log(`Fetching DNS records from MIAB (${apiUrl})...`);
			if (zone) {
				console.log(`Filtering for zone: ${zone}`);
			}
			if (filter) {
				console.log(`Applying filter: ${filter}`);
			}
		}

		// Fetch DNS zones from MIAB
		const result = await fetchMiabDnsZones({
			baseUrl: apiUrl,
			auth,
			verbose,
		});

		if (!result.success) {
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

		return {
			success: true,
			message: `Successfully retrieved ${zones.length} DNS zones with ${totalRecords} records`,
			data: {
				connection: {
					baseUrl: apiUrl,
					username: email,
					authenticated: true,
					environment: "MIAB",
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
