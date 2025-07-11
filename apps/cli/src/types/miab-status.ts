import type { SystemStatusResponse } from "@miab-inwx/miab-client";

export interface StatusData {
	url: string;
	baseUrl: string;
	status: SystemStatusResponse;
	summary: {
		totalChecks: number;
		errors: number;
		warnings: number;
		ok: number;
		hasErrors: boolean;
		hasWarnings: boolean;
	};
	version?: string;
	rebootRequired?: boolean;
	timestamp: string;
}
