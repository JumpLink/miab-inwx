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
