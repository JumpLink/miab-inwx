import type { Argv } from "yargs";
import { getInwxStatus } from "../../actions/inwx/status.ts";

interface StatusOptions {
	username: string;
	password: string;
	sharedSecret?: string;
	"shared-secret"?: string;
	environment?: "ote" | "live";
	verbose?: boolean;
}

export function statusCommand(yargs: Argv): void {
	yargs.command({
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
		handler: async (args: any) => {
			const statusOptions = args as StatusOptions;
			const result = await getInwxStatus({
				username: statusOptions.username,
				password: statusOptions.password,
				sharedSecret: statusOptions.sharedSecret || statusOptions["shared-secret"],
				environment: statusOptions.environment,
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
		},
	} as any);
}
