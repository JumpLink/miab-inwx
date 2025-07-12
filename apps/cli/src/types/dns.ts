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
 * Record normalization result
 */
export interface NormalizedRecord {
	name: string;
	content: string;
}

/**
 * Environment information for INWX API
 */
export interface InwxEnvironmentInfo {
	name: string;
	apiUrl: string;
	isOte: boolean;
} 