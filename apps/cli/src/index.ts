#!/usr/bin/env node

import dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { debugCommand } from "./commands/debug.ts";
import { inwxCommand } from "./commands/inwx.ts";
import { miabCommand } from "./commands/miab.ts";
import { migrateCommand } from "./commands/migrate.ts";

// Load environment variables from .env file
dotenv.config();

const cli = yargs(hideBin(process.argv))
	.scriptName("miab-cli")
	.usage("$0 <command> [options]")
	.version("1.0.0")
	.help()
	.alias("h", "help")
	.alias("v", "version")
	.demandCommand(1, "You need to provide at least one command")
	.strict()
	.recommendCommands()
	.showHelpOnFail(false, "Use --help to see available commands");

// Register commands
miabCommand(cli);
inwxCommand(cli);
migrateCommand(cli);
debugCommand(cli);

// Parse and execute
cli.parse();
