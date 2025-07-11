import type { MiabConnectionOptions } from "./index.ts";
import type { InwxConnectionOptions } from "./inwx-test.ts";

export interface MigrateDnsOptions {
	miab: MiabConnectionOptions;
	inwx: InwxConnectionOptions;
	dryRun?: boolean;
	force?: boolean;
}

export interface DnsRecord {
	qname: string;
	rtype: string;
	value: string;
	explanation?: string;
}

export interface DnsZone {
	domain: string;
	records: DnsRecord[];
}

export interface MigrationResult {
	zone: string;
	totalRecords: number;
	processedRecords: number;
	successfulRecords: number;
	failedRecords: number;
	errors: string[];
	warnings: string[];
}

export interface MigrateDnsData {
	miab: {
		baseUrl: string;
		username: string;
		authenticated: boolean;
		zones: string[];
	};
	inwx: {
		username: string;
		environment: "ote" | "live";
		apiUrl: string;
		authenticated: boolean;
	};
	migration: {
		dryRun: boolean;
		force: boolean;
		results: MigrationResult[];
		totalZones: number;
		processedZones: number;
		successfulZones: number;
		failedZones: number;
		timestamp: string;
	};
}
