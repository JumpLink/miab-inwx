import type { InwxConnectionOptions } from "./inwx-test.ts";
import type { DnsZone } from "./migrate-dns.ts";

export interface InwxListOptions extends InwxConnectionOptions {
	format?: "table" | "json" | "yaml";
	filter?: string;
	zone?: string;
}

export interface InwxListData {
	connection: {
		username: string;
		environment: "ote" | "live";
		apiUrl: string;
		authenticated: boolean;
	};
	zones: DnsZone[];
	totalZones: number;
	totalRecords: number;
	timestamp: string;
}
