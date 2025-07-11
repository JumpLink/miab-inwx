import type { Argv } from "yargs";
import { testMiabConnection } from "../../actions/miab/test.ts";
import { getMiabConnectionFromEnv, printEnvExample } from "../../utils/env.ts";

interface TestOptions {
	verbose?: boolean;
}

export function testCommand(yargs: Argv): void {
	yargs.command<TestOptions>({
		command: "test",
		describe: "Test the connection to the Mail-in-a-Box server (credentials from .env file)",
		builder: (yargs: Argv) => {
			return yargs
				.option("verbose", {
					type: "boolean",
					description: "Enable verbose output",
					default: false,
				})
				.example("$0 miab test", "Test MIAB server connection")
				.example("$0 miab test --verbose", "Test MIAB server connection with verbose output");
		},
		handler: async (args: TestOptions) => {
			try {
				const connectionOptions = getMiabConnectionFromEnv();
				const result = await testMiabConnection({
					...connectionOptions,
					verbose: args.verbose,
				});

				if (result.success) {
					console.log(`✅ ${result.message}`);
					if (args.verbose && result.data) {
						console.log("Connection Details:");
						console.log(`  Server URL: ${result.data.baseUrl}`);
						console.log(`  Version: ${result.data.version}`);
						console.log(`  Authenticated: ${result.data.authenticated}`);
						console.log(`  Timestamp: ${result.data.timestamp}`);
					}
				} else {
					console.error(`❌ ${result.error}`);
					process.exit(1);
				}
			} catch (error) {
				console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
				console.log("\n💡 Make sure you have a .env file with the required MIAB credentials:");
				printEnvExample();
				process.exit(1);
			}
		},
	});
}
