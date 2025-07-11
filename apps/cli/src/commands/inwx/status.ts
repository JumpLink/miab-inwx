import type { Argv } from "yargs";
import { getInwxStatus } from "../../actions/inwx/status.ts";
import type { InwxConnectionOptions } from "../../types/commands.ts";

interface StatusOptions extends InwxConnectionOptions {
	// Additional status-specific options can be added here
}

export function statusCommand(yargs: Argv): void {
	yargs.command<StatusOptions>({
		command: "status",
		describe: "Check the status of the INWX account",
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
				.example("$0 inwx status -u username -p password", "Check INWX account status (OTE)")
				.example("$0 inwx status -u username -p password -e live", "Check INWX account status (Live)")
				.example("$0 inwx status -u username -p password -s secret", "Check INWX account status with 2FA");
		},
		handler: async (args: StatusOptions) => {
			const result = await getInwxStatus({
				username: args.username,
				password: args.password,
				sharedSecret: args.sharedSecret || args["shared-secret"],
				environment: args.environment,
				verbose: args.verbose,
			});

			if (result.success) {
				console.log(`✅ ${result.message}`);

				if (result.data?.accountInfo?.resData) {
					const accountData = result.data.accountInfo.resData;
					console.log("\nAccount Information:");

					if (accountData.customer) {
						console.log(`  Customer ID: ${accountData.customer.id || "N/A"}`);
						console.log(`  Customer Name: ${accountData.customer.name || "N/A"}`);
						console.log(`  Customer Email: ${accountData.customer.email || "N/A"}`);
						console.log(`  Account Type: ${accountData.customer.type || "N/A"}`);
					}

					if (accountData.balance !== undefined) {
						console.log(`  Balance: ${accountData.balance} ${accountData.currency || "EUR"}`);
					}
				}

				if (args.verbose && result.data) {
					console.log("\nConnection Details:");
					console.log(`  Username: ${result.data.username}`);
					console.log(`  Environment: ${result.data.environment.toUpperCase()}`);
					console.log(`  API URL: ${result.data.apiUrl}`);
					console.log(`  Response Code: ${result.data.accountInfo.code}`);
					console.log(`  Response Message: ${result.data.accountInfo.msg}`);
					console.log(`  Timestamp: ${result.data.timestamp}`);
				}
			} else {
				console.error(`❌ ${result.error}`);
				process.exit(1);
			}
		},
	});
}
