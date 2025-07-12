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

// Constants for INWX API response codes
export const INWX_SUCCESS_CODE = 1000;
export const INWX_ZONE_NOT_FOUND_CODE = 2303;
export const INWX_RECORD_EXISTS_CODE = 2302;
export const INWX_POLICY_VIOLATION_CODE = 2308; 