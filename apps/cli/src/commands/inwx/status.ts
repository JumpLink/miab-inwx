import type { Argv } from "yargs";
import { getInwxStatus } from "../../actions/inwx/status.ts";
import { getInwxConnectionFromEnv, printEnvExample } from "../../utils/env.ts";

interface StatusOptions {
	verbose?: boolean;
}

export function statusCommand(yargs: Argv): void {
	yargs.command({
		command: "status",
		describe: "Check the status of the INWX account (credentials from .env file)",
		builder: (yargs: Argv) => {
			return yargs
				.option("verbose", {
					type: "boolean",
					description: "Enable verbose output",
					default: false,
				})
				.example("$0 inwx status", "Check INWX account status")
				.example("$0 inwx status --verbose", "Check INWX account status with verbose output");
		},
		handler: async (args: unknown) => {
			const statusOptions = args as StatusOptions;

			try {
				const connectionOptions = getInwxConnectionFromEnv();
				const result = await getInwxStatus({
					...connectionOptions,
					verbose: statusOptions.verbose,
				});

				if (result.success) {
					console.log(`✅ ${result.message}`);

					if (result.data?.accountInfo?.resData) {
						const accountData = result.data.accountInfo.resData;
						console.log("\nAccount Information:");

						console.log(`  Account ID: ${accountData.accountId || "N/A"}`);
						console.log(`  Customer ID: ${accountData.customerId || "N/A"}`);
						console.log(`  Customer No: ${accountData.customerNo || "N/A"}`);
						console.log(`  Username: ${accountData.username || "N/A"}`);
						console.log(
							`  Name: ${accountData.title || ""} ${accountData.firstname || ""} ${accountData.lastname || ""}`,
						);
						console.log(`  Organization: ${accountData.org || "N/A"}`);
						console.log(`  Email: ${accountData.email || "N/A"}`);
						console.log(`  Country: ${accountData.cc || "N/A"}`);
						console.log(`  Payment Type: ${accountData.paymentType || "N/A"}`);
						console.log(`  Currency: ${accountData.currency || "N/A"}`);
						console.log(`  Verification Level: ${accountData.verification || "N/A"}`);
						console.log(`  2FA Enabled: ${accountData.tfa === "0" ? "No" : "Yes"}`);
						console.log(`  Is Reseller: ${accountData.isReseller || "N/A"}`);
						console.log(`  Renewal Mode: ${accountData.renewalMode || "N/A"}`);
						console.log(`  Login Count: ${accountData.loginCount || "N/A"}`);

						if (accountData.lastLogin?.scalar) {
							console.log(`  Last Login: ${accountData.lastLogin.scalar}`);
						}

						if (accountData.crDate?.scalar) {
							console.log(`  Account Created: ${accountData.crDate.scalar}`);
						}
					}

					if (statusOptions.verbose && result.data) {
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
			} catch (error) {
				console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
				console.log("\n💡 Make sure you have a .env file with the required INWX credentials:");
				printEnvExample();
				process.exit(1);
			}
		},
	});
}
