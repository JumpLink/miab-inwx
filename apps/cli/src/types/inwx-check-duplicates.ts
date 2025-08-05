/**
 * Options for checking INWX duplicate records
 */
export interface InwxCheckDuplicatesOptions {
	username: string;
	password: string;
	sharedSecret?: string;
	environment?: "ote" | "live";
	verbose?: boolean;
	domains?: string[];
}

/**
 * Data returned from checking INWX duplicates
 */
export interface InwxCheckDuplicatesData {
	inwx: {
		username: string;
		environment: string;
		authenticated: boolean;
	};
	duplicates: {
		totalZonesChecked: number;
		zonesWithDuplicates: number;
		totalDuplicateIssues: number;
		duplicatesByZone: Array<{
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
		}>;
	};
}
