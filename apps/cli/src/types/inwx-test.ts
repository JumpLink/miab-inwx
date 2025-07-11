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
