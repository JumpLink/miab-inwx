import type { Argv } from "yargs";
import { testInwxConnection } from "../../actions/inwx/test.ts";

interface TestOptions {
	username: string;
	password: string;
	sharedSecret?: string;
	"shared-secret"?: string;
	environment?: "ote" | "live";
	verbose?: boolean;
}

export function testCommand(yargs: Argv): void {
	yargs.command({
		command: "test",
		describe: "Test the connection to the INWX API",
		builder: (yargs: Argv) => {
			return yargs
				.option("username", {
					alias: "u",
					type: "string",
					description: "INWX username",
					demandOption: true,
				})
				.option("password", {
					alias: "p",
					type: "string",
					description: "INWX password",
					demandOption: true,
				})
				.option("shared-secret", {
					alias: "s",
					type: "string",
					description: "INWX shared secret for 2FA (optional)",
				})
				.option("environment", {
					alias: "e",
					type: "string",
					choices: ["ote", "live"] as const,
					default: "ote",
					description: "INWX environment (ote=test, live=production)",
				})
				.option("verbose", {
					type: "boolean",
					description: "Enable verbose output",
					default: false,
				})
				.example("$0 inwx test -u username -p password", "Test INWX connection (OTE)")
				.example("$0 inwx test -u username -p password -e live", "Test INWX connection (Live)")
				.example("$0 inwx test -u username -p password -s secret", "Test INWX connection with 2FA");
		},
		handler: async (args: unknown) => {
			const testOptions = args as TestOptions;
			const result = await testInwxConnection({
				username: testOptions.username,
				password: testOptions.password,
				sharedSecret: testOptions.sharedSecret || testOptions["shared-secret"],
				environment: testOptions.environment,
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
		},
	});
}
