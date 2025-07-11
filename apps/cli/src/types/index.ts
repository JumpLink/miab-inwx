import type { SystemStatusResponse } from "@miab-inwx/miab-client";

// Common CLI types
export interface BaseCommandOptions {
	verbose?: boolean;
	config?: string;
}

// MIAB API related types
export interface MiabConfig {
	apiUrl: string;
	email: string;
	password: string;
}

export interface MiabConnectionOptions extends BaseCommandOptions {
	apiUrl?: string;
	email?: string;
	password?: string;
}

// Command result types
export interface CommandResult<T = unknown> {
	success: boolean;
	message?: string;
	data?: T;
	error?: string;
}

// Specific data types for different commands
export interface StatusData {
	url: string;
	baseUrl: string;
	status: SystemStatusResponse;
	summary: {
		totalChecks: number;
		errors: number;
		warnings: number;
		ok: number;
		hasErrors: boolean;
		hasWarnings: boolean;
	};
	version?: string;
	rebootRequired?: boolean;
	timestamp: string;
}

export interface TestData {
	url: string;
	baseUrl: string;
	authenticated: boolean;
	version: string;
	timestamp: string;
}

// CLI Configuration
export interface CliConfig {
	miab?: MiabConfig;
	defaultProfile?: string;
	profiles?: Record<string, MiabConfig>;
}
