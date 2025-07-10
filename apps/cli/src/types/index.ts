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
export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

// CLI Configuration
export interface CliConfig {
  miab?: MiabConfig;
  defaultProfile?: string;
  profiles?: Record<string, MiabConfig>;
} 