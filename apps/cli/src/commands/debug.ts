import type { Argv } from "yargs";
import { debugEnvConfig } from "../utils/env.ts";

/**
 * Debug command to show environment variable status
 */
export function debugCommand(yargs: Argv): void {
	yargs.command({
		command: "debug",
		describe: "Show environment variable debug information",
		handler: () => {
			debugEnvConfig();
		},
	});
}
