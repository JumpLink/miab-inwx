import type { MiabConnectionOptions } from "./index.ts";
import type { DnsZone } from "./migrate-dns.ts";

export interface MiabListOptions extends MiabConnectionOptions {
	format?: "table" | "json" | "yaml";
	filter?: string;
	zone?: string;
}

export interface MiabListData {
	connection: {
		baseUrl: string;
		username: string;
		authenticated: boolean;
		environment: string;
	};
	zones: DnsZone[];
	totalZones: number;
	totalRecords: number;
	timestamp: string;
}
