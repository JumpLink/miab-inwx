import type { Argv } from "yargs";
import type { BaseCommandOptions, CommandResult } from "./index.ts";

// Command handler function type
export type CommandHandler<T extends BaseCommandOptions = BaseCommandOptions> = (args: T) => Promise<CommandResult>;

// Command builder function type
export type CommandBuilder<T extends BaseCommandOptions = BaseCommandOptions> = (yargs: Argv) => Argv<T>;

// Command definition interface
export interface CommandDefinition<T extends BaseCommandOptions = BaseCommandOptions> {
	command: string;
	describe: string;
	builder: CommandBuilder<T>;
	handler: CommandHandler<T>;
}

// INWX-specific types
export interface InwxConnectionOptions {
	username: string;
	password: string;
	sharedSecret?: string;
	"shared-secret"?: string;
	environment?: "ote" | "live";
	verbose?: boolean;
}

export interface InwxTestData {
	username: string;
	environment: "ote" | "live";
	apiUrl: string;
	authenticated: boolean;
	loginResponse?: {
		code: number;
		msg: string;
		resData?: Record<string, unknown>;
	};
	timestamp: string;
}

export interface InwxStatusData {
	username: string;
	environment: "ote" | "live";
	apiUrl: string;
	accountInfo: {
		code: number;
		msg: string;
		resData?: {
			customer?: {
				id?: number;
				name?: string;
				email?: string;
				type?: string;
			};
			balance?: number;
			currency?: string;
			// Add more fields as needed from account.info response
		};
	};
	timestamp: string;
}
