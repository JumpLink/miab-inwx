import type { ApiClient } from "domrobot-client";
import type { MiabConnectionOptions } from "./index.ts";
import type { InwxConnectionOptions } from "./inwx-test.ts";

/**
 * Strategy for handling conflicting DNS records
 */
export type ConflictResolutionStrategy = "skip" | "overwrite" | "interactive";

export interface MigrateDnsOptions {
	miab: MiabConnectionOptions;
	inwx: InwxConnectionOptions;
	dryRun?: boolean;
	conflictResolution?: ConflictResolutionStrategy;
	excludeDomains?: string[];
}

/**
 * Configuration for API clients
 */
export interface ApiClientConfig {
	miab: {
		baseUrl: string;
		auth: string;
		verbose?: boolean;
	};
	inwx: {
		client: ApiClient;
		username: string;
		password: string;
		sharedSecret?: string;
		verbose?: boolean;
	};
}

/**
 * Migration context for tracking progress
 */
export interface MigrationContext {
	totalZones: number;
	processedZones: number;
	successfulZones: number;
	failedZones: number;
	startTime: number;
	dryRun: boolean;
	verbose: boolean;
	conflictResolution: ConflictResolutionStrategy;
	excludeDomains: string[];
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

/**
 * Result of comparing two DNS records
 */
export interface RecordComparison {
	areEqual: boolean;
	differences: string[];
}

/**
 * Information about an existing INWX record
 */
export interface ExistingInwxRecord {
	id: string;
	name: string;
	type: string;
	content: string;
	ttl?: number;
	prio?: number;
	weight?: number; // For SRV records
	port?: number; // For SRV records
}

export interface MigrationResult {
	zone: string;
	totalRecords: number;
	processedRecords: number;
	successfulRecords: number;
	failedRecords: number;
	skippedRecords: number;
	updatedRecords: number;
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
		results: MigrationResult[];
		totalZones: number;
		processedZones: number;
		successfulZones: number;
		failedZones: number;
		timestamp: string;
	};
}
