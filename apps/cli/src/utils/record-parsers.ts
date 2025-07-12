import type { ParsedMxRecord, ParsedSrvRecord } from "../types/dns.ts";

/**
 * Parse MX record value
 */
export function parseMxRecord(value: string): ParsedMxRecord {
	const mxParts = value.trim().split(/\s+/);
	if (mxParts.length >= 2) {
		const priority = parseInt(mxParts[0], 10);
		const content = mxParts.slice(1).join(" ");
		return { prio: priority, content };
	}
	return { prio: 10, content: value };
}

/**
 * Parse SRV record value
 */
export function parseSrvRecord(value: string): ParsedSrvRecord {
	const srvParts = value.trim().split(/\s+/);
	if (srvParts.length >= 4) {
		const priority = parseInt(srvParts[0], 10);
		const weight = parseInt(srvParts[1], 10);
		const port = parseInt(srvParts[2], 10);
		const content = srvParts.slice(3).join(" ");
		return { prio: priority, weight, port, content };
	}
	// Fallback if parsing fails
	return { prio: 0, weight: 0, port: 80, content: value };
}

/**
 * Clean SSHFP record value
 */
export function cleanSshfpRecord(value: string): string {
	return value.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
} 