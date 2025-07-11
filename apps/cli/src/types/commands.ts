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
