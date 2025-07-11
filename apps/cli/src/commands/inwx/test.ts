import type { Argv } from "yargs";
import { testInwxConnection } from "../../actions/inwx/test.ts";
import { getInwxConnectionFromEnv, printEnvExample } from "../../utils/env.ts";

interface TestOptions {
	verbose?: boolean;
}

export function testCommand(yargs: Argv): void {
	yargs.command({
		command: "test",
		describe: "Test the connection to the INWX API (credentials from .env file)",
		builder: (yargs: Argv) => {
			return yargs
				.option("verbose", {
					type: "boolean",
					description: "Enable verbose output",
					default: false,
				})
				.example("$0 inwx test", "Test INWX connection")
				.example("$0 inwx test --verbose", "Test INWX connection with verbose output");
		},
		handler: async (args: unknown) => {
			const testOptions = args as TestOptions;

			try {
				const connectionOptions = getInwxConnectionFromEnv();
				const result = await testInwxConnection({
					...connectionOptions,
					verbose: testOptions.verbose,
				});

				if (result.success) {
					console.log(`✅ ${result.message}`);
					if (testOptions.verbose && result.data) {
						console.log("Connection Details:");
						console.log(`  Username: ${result.data.username}`);
						console.log(`  Environment: ${result.data.environment.toUpperCase()}`);
						console.log(`  API URL: ${result.data.apiUrl}`);
						console.log(`  Authenticated: ${result.data.authenticated}`);
						console.log(`  Response Code: ${result.data.loginResponse?.code}`);
						console.log(`  Response Message: ${result.data.loginResponse?.msg}`);
						console.log(`  Timestamp: ${result.data.timestamp}`);
					}
				} else {
					console.error(`❌ ${result.error}`);
					process.exit(1);
				}
			} catch (error) {
				console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
				console.log("\n💡 Make sure you have a .env file with the required INWX credentials:");
				printEnvExample();
				process.exit(1);
			}
		},
	});
}
