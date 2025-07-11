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

// INWX-specific types
export interface InwxConnectionOptions {
	username: string;
	password: string;
	sharedSecret?: string;
	"shared-secret"?: string;
	environment?: "ote" | "live";
	verbose?: boolean;
}

export interface InwxTestData {
	username: string;
	environment: "ote" | "live";
	apiUrl: string;
	authenticated: boolean;
	loginResponse?: {
		code: number;
		msg: string;
		resData?: Record<string, unknown>;
	};
	timestamp: string;
}

export interface InwxStatusData {
	username: string;
	environment: "ote" | "live";
	apiUrl: string;
	accountInfo: {
		code: number;
		msg: string;
		resData?: {
			accountId?: number;
			customerId?: number;
			customerNo?: number;
			username?: string;
			title?: string;
			firstname?: string;
			lastname?: string;
			org?: string;
			street?: string;
			pc?: string;
			city?: string;
			cc?: string;
			voice?: string;
			email?: string;
			servicePin?: number;
			crDate?: {
				scalar?: string;
				xmlrpc_type?: string;
				timestamp?: number;
			};
			secureMode?: boolean;
			signPdfs?: boolean;
			summaryInvoice?: boolean;
			language?: string;
			notificationEmail?: number;
			notificationQueue?: boolean;
			renewalReport?: boolean;
			paymentType?: string;
			vat?: string;
			defaultRegistrant?: number;
			defaultAdmin?: number;
			defaultTech?: number;
			defaultBilling?: number;
			defaultNsset?: number;
			defaultImportNS?: boolean;
			lastLogin?: {
				scalar?: string;
				xmlrpc_type?: string;
				timestamp?: number;
			};
			loginCount?: number;
			rowsPerPage?: number;
			verification?: number;
			tfa?: string;
			currency?: string;
			isReseller?: string;
			dynDnsAccounts?: number;
			disablePremium?: number;
			renewalMode?: string;
			invoiceXml?: number;
			invoicePdf?: number;
			allowedPaymentTypes?: string[];
			lastIP?: string;
			emailBilling?: string | null;
			mailListId?: number[];
		};
	};
	timestamp: string;
}
