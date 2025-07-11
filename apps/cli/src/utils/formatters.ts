import type { SystemStatusResponse } from "@miab-inwx/miab-client";

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
 * Format connection details for display
 */
export function formatConnectionDetails(data: any): string {
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
