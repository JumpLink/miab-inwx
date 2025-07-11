// Export core CLI types
export * from "./commands.ts";
// Export INWX-specific types
export * from "./inwx-status.ts";
export * from "./inwx-test.ts";
// Export MIAB-specific types
export * from "./miab-status.ts";
export * from "./miab-test.ts";

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

// CLI Configuration
export interface CliConfig {
	miab?: MiabConfig;
	defaultProfile?: string;
	profiles?: Record<string, MiabConfig>;
}
