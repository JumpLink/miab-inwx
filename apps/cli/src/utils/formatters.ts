import type { SystemStatusResponse } from "@miab-inwx/miab-client";
import type { DnsZone } from "../types/migrate-dns.ts";

/**
 * Format system status for console output
 */
export function formatSystemStatus(statusData: SystemStatusResponse, verbose: boolean = false): string {
	const lines: string[] = [];

	// Group entries by type
	const entries = {
		error: statusData.filter((entry) => entry.type === "error"),
		warning: statusData.filter((entry) => entry.type === "warning"),
		ok: statusData.filter((entry) => entry.type === "ok"),
		heading: statusData.filter((entry) => entry.type === "heading"),
	};

	// Summary first
	lines.push("\n📊 Status Summary:");
	lines.push(`  Total checks: ${statusData.length}`);
	lines.push(`  ✅ OK: ${entries.ok.length}`);
	lines.push(`  ⚠️  Warnings: ${entries.warning.length}`);
	lines.push(`  ❌ Errors: ${entries.error.length}`);

	// Show errors first (most important)
	if (entries.error.length > 0) {
		lines.push("\n❌ Errors:");
		for (const entry of entries.error) {
			lines.push(`  • ${entry.text}`);
			if (verbose && entry.extra?.length > 0) {
				for (const extra of entry.extra) {
					lines.push(`    - ${extra.text}`);
				}
			}
		}
	}

	// Show warnings
	if (entries.warning.length > 0) {
		lines.push("\n⚠️  Warnings:");
		for (const entry of entries.warning) {
			lines.push(`  • ${entry.text}`);
			if (verbose && entry.extra?.length > 0) {
				for (const extra of entry.extra) {
					lines.push(`    - ${extra.text}`);
				}
			}
		}
	}

	// In verbose mode, show all OK entries too
	if (verbose && entries.ok.length > 0) {
		lines.push("\n✅ OK:");
		for (const entry of entries.ok) {
			lines.push(`  • ${entry.text}`);
			if (entry.extra?.length > 0) {
				for (const extra of entry.extra) {
					lines.push(`    - ${extra.text}`);
				}
			}
		}
	}

	return lines.join("\n");
}

/**
 * Get appropriate emoji for status type
 */
export function getStatusIcon(hasErrors: boolean, hasWarnings: boolean): string {
	if (hasErrors) return "❌";
	if (hasWarnings) return "⚠️";
	return "✅";
}

/**
 * Connection details for display formatting
 */
export interface ConnectionDetails {
	baseUrl?: string;
	url?: string;
	version?: string;
	rebootRequired?: boolean;
	authenticated?: boolean;
	timestamp?: string;
}

/**
 * Format connection details for display
 */
export function formatConnectionDetails(data: ConnectionDetails): string {
	const lines: string[] = [];

	lines.push("\n🔗 Connection Details:");
	lines.push(`  Server URL: ${data.baseUrl || data.url}`);
	if (data.version) {
		lines.push(`  Version: ${data.version}`);
	}
	if (data.rebootRequired !== undefined) {
		lines.push(`  Reboot Required: ${data.rebootRequired ? "Yes" : "No"}`);
	}
	lines.push(`  Authenticated: ${data.authenticated ? "Yes" : "No"}`);
	lines.push(`  Timestamp: ${data.timestamp}`);

	return lines.join("\n");
}

/**
 * Format DNS zones and records for output
 */
export function formatDnsOutput(zones: DnsZone[], format: "table" | "yaml"): string {
	if (format === "yaml") {
		return formatDnsAsYaml(zones);
	}

	return formatDnsAsTable(zones);
}

/**
 * Format DNS data as table
 */
function formatDnsAsTable(zones: DnsZone[]): string {
	const lines: string[] = [];

	for (const zone of zones) {
		if (zone.records.length === 0) continue;

		// Add some spacing between zones if not the first one
		if (lines.length > 0) {
			lines.push("");
		}

		// Table header
		lines.push("┌─────────────────────────────────────────────────────────────────────────────────────┐");
		lines.push("│ Name                    │ Type │ Value                              │ TTL/Note    │");
		lines.push("├─────────────────────────────────────────────────────────────────────────────────────┤");

		// Table rows
		for (const record of zone.records) {
			const name = record.qname.length > 23 ? `${record.qname.substring(0, 20)}...` : record.qname;
			const type = record.rtype.length > 4 ? record.rtype.substring(0, 4) : record.rtype;
			const value = record.value.length > 34 ? `${record.value.substring(0, 31)}...` : record.value;
			const explanation =
				record.explanation?.length > 11 ? `${record.explanation.substring(0, 8)}...` : record.explanation || "";

			lines.push(`│ ${name.padEnd(23)} │ ${type.padEnd(4)} │ ${value.padEnd(34)} │ ${explanation.padEnd(11)} │`);
		}

		lines.push("└─────────────────────────────────────────────────────────────────────────────────────┘");
	}

	return lines.join("\n");
}

/**
 * Format DNS data as YAML
 */
function formatDnsAsYaml(zones: DnsZone[]): string {
	const lines: string[] = [];

	lines.push("zones:");

	for (const zone of zones) {
		lines.push(`  - domain: "${zone.domain}"`);
		lines.push("    records:");

		for (const record of zone.records) {
			lines.push(`      - name: "${record.qname}"`);
			lines.push(`        type: "${record.rtype}"`);
			lines.push(`        value: "${record.value}"`);
			if (record.explanation) {
				lines.push(`        note: "${record.explanation}"`);
			}
		}
	}

	return lines.join("\n");
}
