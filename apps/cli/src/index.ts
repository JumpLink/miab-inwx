#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { miabCommand } from "./commands/miab.ts";

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

// Parse and execute
cli.parse();
