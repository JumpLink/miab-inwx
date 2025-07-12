import { select } from "@inquirer/prompts";
import type {
	ConflictResolutionStrategy,
	DnsRecord,
	ExistingInwxRecord,
	RecordComparison,
} from "../types/migrate-dns.ts";
import { compareRecords } from "./dns.ts";

/**
 * Action to take for a conflicting record
 */
export type ConflictAction = "skip" | "overwrite";

/**
 * Resolve conflict for a single DNS record
 */
export async function resolveRecordConflict(
	miabRecord: DnsRecord,
	existingRecord: ExistingInwxRecord,
	strategy: ConflictResolutionStrategy,
	zoneProgress: string,
	verbose?: boolean,
): Promise<ConflictAction> {
	const comparison = compareRecords(miabRecord, existingRecord);

	// If records are equal, no conflict exists
	if (comparison.areEqual) {
		if (verbose) {
			console.log(`${zoneProgress}   ✅ Record unchanged: ${miabRecord.rtype} ${miabRecord.qname}`);
		}
		return "skip";
	}

	// Handle conflict based on strategy
	switch (strategy) {
		case "skip":
			if (verbose) {
				console.log(`${zoneProgress}   ⏭️  Skipping conflicting record: ${miabRecord.rtype} ${miabRecord.qname}`);
				console.log(`${zoneProgress}       Differences: ${comparison.differences.join(", ")}`);
			}
			return "skip";

		case "overwrite":
			if (verbose) {
				console.log(`${zoneProgress}   🔄 Overwriting conflicting record: ${miabRecord.rtype} ${miabRecord.qname}`);
				console.log(`${zoneProgress}       Differences: ${comparison.differences.join(", ")}`);
			}
			return "overwrite";

		case "interactive":
			return await promptForConflictResolution(miabRecord, existingRecord, comparison, zoneProgress);

		default:
			// Fallback to skip for unknown strategies
			return "skip";
	}
}

/**
 * Prompt user for conflict resolution decision
 */
async function promptForConflictResolution(
	miabRecord: DnsRecord,
	existingRecord: ExistingInwxRecord,
	comparison: RecordComparison,
	zoneProgress: string,
): Promise<ConflictAction> {
	console.log(`\n${zoneProgress} 🔍 Conflict detected for record: ${miabRecord.rtype} ${miabRecord.qname}`);
	console.log(`${zoneProgress}    Differences found:`);

	for (const difference of comparison.differences) {
		console.log(`${zoneProgress}      • ${difference}`);
	}

	console.log(`${zoneProgress}    Current INWX record:`);
	console.log(`${zoneProgress}      Name: ${existingRecord.name}`);
	console.log(`${zoneProgress}      Type: ${existingRecord.type}`);
	console.log(`${zoneProgress}      Content: ${existingRecord.content}`);
	// Only show priority for record types that actually use it (MX records)
	if (existingRecord.prio !== undefined && existingRecord.type === "MX") {
		console.log(`${zoneProgress}      Priority: ${existingRecord.prio}`);
	}
	if (existingRecord.ttl !== undefined) {
		console.log(`${zoneProgress}      TTL: ${existingRecord.ttl}`);
	}

	console.log(`${zoneProgress}    New MIAB record would be:`);
	console.log(`${zoneProgress}      Name: ${miabRecord.qname}`);
	console.log(`${zoneProgress}      Type: ${miabRecord.rtype}`);
	// Clean SSHFP records for display consistency
	const displayValue =
		miabRecord.rtype === "SSHFP" ? miabRecord.value.replace(/[()]/g, "").replace(/\s+/g, " ").trim() : miabRecord.value;
	console.log(`${zoneProgress}      Content: ${displayValue}`);

	try {
		const action = await select({
			message: "What would you like to do with this conflicting record?",
			choices: [
				{
					name: "Skip - Keep existing INWX record unchanged",
					value: "skip" as ConflictAction,
				},
				{
					name: "Overwrite - Replace with MIAB record",
					value: "overwrite" as ConflictAction,
				},
			],
			default: "skip",
		});

		console.log(`${zoneProgress}    Decision: ${action.toUpperCase()}\n`);
		return action;
	} catch (_error) {
		// Handle user cancellation (Ctrl+C)
		console.log(`\n${zoneProgress}    Cancelled by user, defaulting to SKIP\n`);
		return "skip";
	}
}

/**
 * Format record value for display
 */
export function formatRecordForDisplay(record: DnsRecord): string {
	const parts = [record.rtype, record.qname];

	if (record.rtype === "MX") {
		// For MX records, show priority and content separately
		const mxParts = record.value.trim().split(/\s+/);
		if (mxParts.length >= 2) {
			parts.push(`(${mxParts[0]})`, mxParts.slice(1).join(" "));
		} else {
			parts.push(record.value);
		}
	} else {
		parts.push(record.value);
	}

	return parts.join(" ");
}

/**
 * Format existing INWX record for display
 */
export function formatExistingRecordForDisplay(record: ExistingInwxRecord): string {
	const parts = [record.type, record.name];

	if (record.type === "MX" && record.prio !== undefined) {
		parts.push(`(${record.prio})`, record.content);
	} else {
		parts.push(record.content);
	}

	if (record.ttl !== undefined) {
		parts.push(`[TTL: ${record.ttl}]`);
	}

	return parts.join(" ");
}
