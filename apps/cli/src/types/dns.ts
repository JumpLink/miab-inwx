/**
 * Connection configuration for MIAB
 */
export interface MiabConnectionConfig {
	baseUrl: string;
	auth: string;
	verbose?: boolean;
}

/**
 * Connection configuration for INWX
 */
export interface InwxConnectionConfig {
	username: string;
	password: string;
	sharedSecret?: string;
	environment?: "ote" | "live";
	verbose?: boolean;
}

/**
 * Parsed DNS record data
 */
export interface ParsedMxRecord {
	prio: number;
	content: string;
}

export interface ParsedSrvRecord {
	prio: number;
	weight: number;
	port: number;
	content: string;
}

/**
 * INWX environment information
 */
export interface InwxEnvironmentInfo {
	name: string;
	apiUrl: string;
	isOte: boolean;
}

/**
 * Normalized record for comparison
 */
export interface NormalizedRecord {
	name: string;
	content: string;
}

/**
 * INWX API record object structure
 */
export interface InwxApiRecord {
	id?: string;
	name?: string;
	type?: string;
	content?: string;
	ttl?: number;
	prio?: number;
	weight?: number;
	port?: number;
	[key: string]: unknown;
}

/**
 * INWX API response for nameserver.info
 */
export interface InwxNameserverInfoResponse {
	code: number;
	msg: string;
	resData?: {
		record?: InwxApiRecord[];
	};
}
