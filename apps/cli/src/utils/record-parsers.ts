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
	const trimmedValue = value.trim();
	const srvParts = trimmedValue.split(/\s+/);

	if (srvParts.length >= 4) {
		const priority = parseInt(srvParts[0], 10);
		const weight = parseInt(srvParts[1], 10);
		const port = parseInt(srvParts[2], 10);
		const content = srvParts.slice(3).join(" ");

		// Validate parsed values
		if (!Number.isNaN(priority) && !Number.isNaN(weight) && !Number.isNaN(port) && content.length > 0) {
			return { prio: priority, weight, port, content };
		}

		// Log warning if parsing seems problematic
		console.warn(`⚠️  SRV record parsing issue for value: "${value}"`);
		console.warn(`    Parsed parts: priority=${priority}, weight=${weight}, port=${port}, content="${content}"`);
		console.warn(`    Parts array:`, srvParts);
	}

	// Fallback if parsing fails - log the issue
	console.warn(`⚠️  SRV record parsing fallback for value: "${value}"`);
	console.warn(`    Split parts (${srvParts.length}):`, srvParts);

	return { prio: 0, weight: 0, port: 80, content: trimmedValue };
}

/**
 * Clean SSHFP record value
 */
export function cleanSshfpRecord(value: string): string {
	return value.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
}
