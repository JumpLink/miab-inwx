import type { InwxApiRecord, NormalizedRecord } from "../types/dns.ts";
import type { DnsRecord, ExistingInwxRecord } from "../types/migrate-dns.ts";
import { cleanSshfpRecord } from "./record-parsers.ts";

/**
 * Normalize record names by removing trailing dots
 */
export function normalizeRecordName(name: string): string {
	return name.replace(/\.$/, "");
}

/**
 * Normalize record content by removing trailing dots
 */
export function normalizeRecordContent(content: string): string {
	return content.replace(/\.$/, "");
}

/**
 * Normalize both MIAB and INWX records for comparison
 */
export function normalizeRecordsForComparison(
	miabRecord: DnsRecord,
	inwxRecord: ExistingInwxRecord,
): { miab: NormalizedRecord; inwx: NormalizedRecord } {
	return {
		miab: {
			name: normalizeRecordName(miabRecord.qname),
			content: normalizeRecordContent(miabRecord.value),
		},
		inwx: {
			name: normalizeRecordName(inwxRecord.name),
			content: normalizeRecordContent(inwxRecord.content),
		},
	};
}

/**
 * Check if record type needs content matching for exact identification
 */
export function recordTypeNeedsContentMatching(recordType: string): boolean {
	return ["SSHFP", "TXT", "TLSA", "A", "AAAA"].includes(recordType);
}

/**
 * Normalize content for matching based on record type
 */
export function normalizeContentForMatching(content: string, recordType: string): string {
	if (recordType === "SSHFP") {
		return cleanSshfpRecord(content);
	}
	return normalizeRecordContent(content);
}

/**
 * Check if record content matches for content-sensitive record types
 */
export function doesRecordContentMatch(miabRecord: DnsRecord, inwxRecord: { content: string }): boolean {
	const miabContent = normalizeContentForMatching(miabRecord.value, miabRecord.rtype);
	const inwxContent = normalizeContentForMatching(inwxRecord.content, miabRecord.rtype);
	return miabContent === inwxContent;
}

/**
 * Match an existing INWX record against a MIAB record for the overwrite pre-delete pass.
 *
 * INWX stores the MX/SRV priority in a dedicated `prio` field, while MIAB encodes it
 * inline at the start of the record value (e.g. MIAB "10 mail.example." vs INWX
 * content "mail.example." + prio 10). A plain content comparison therefore treats
 * every MX/SRV as "non-matching" and needlessly deletes + recreates it on each run.
 * Reconstructing the INWX value with its priority prepended fixes that — and keeps a
 * genuinely stale priority (e.g. MIAB changed 10 → 20) correctly flagged for replacement.
 */
export function doesMultiRecordMatch(
	miabRecord: DnsRecord,
	inwxRecord: { content: string; prio?: number | string },
): boolean {
	if (
		(miabRecord.rtype === "MX" || miabRecord.rtype === "SRV") &&
		inwxRecord.prio !== undefined &&
		String(inwxRecord.prio).length > 0
	) {
		return (
			normalizeRecordContent(miabRecord.value) === normalizeRecordContent(`${inwxRecord.prio} ${inwxRecord.content}`)
		);
	}
	return doesRecordContentMatch(miabRecord, inwxRecord);
}

/**
 * Create ExistingInwxRecord from API response record
 */
export function createExistingInwxRecord(record: InwxApiRecord): ExistingInwxRecord {
	return {
		id: record.id || "",
		name: record.name || "",
		type: record.type || "",
		content: record.content || "",
		ttl: record.ttl || 0,
		...(shouldIncludePriority(record) && { prio: record.prio }),
		...(shouldIncludeWeight(record) && { weight: record.weight }),
		...(shouldIncludePort(record) && { port: record.port }),
	};
}

/**
 * Check if record should include priority field
 */
export function shouldIncludePriority(record: InwxApiRecord): boolean {
	return (record.type === "MX" || record.type === "SRV") && record.prio !== undefined;
}

/**
 * Check if record should include weight field
 */
export function shouldIncludeWeight(record: InwxApiRecord): boolean {
	return record.type === "SRV" && record.weight !== undefined;
}

/**
 * Check if record should include port field
 */
export function shouldIncludePort(record: InwxApiRecord): boolean {
	return record.type === "SRV" && record.port !== undefined;
}

/**
 * Find matching record in records array
 */
export function findMatchingRecord(records: InwxApiRecord[], miabRecord: DnsRecord): ExistingInwxRecord | null {
	const normalizedMiabName = normalizeRecordName(miabRecord.qname);

	// Find all records with matching name and type
	const candidateRecords = records.filter((record) => {
		if (!record || typeof record !== "object") return false;

		const normalizedRecordName = normalizeRecordName(record.name || "");
		const recordType = record.type || "";

		return normalizedRecordName === normalizedMiabName && recordType === miabRecord.rtype;
	});

	// Look for exact content match among candidates
	for (const record of candidateRecords) {
		if (doesRecordContentMatch(miabRecord, { content: record.content || "" })) {
			return createExistingInwxRecord(record);
		}
	}

	return null;
}

/**
 * Check if record type allows multiple values
 */
export function allowsMultipleRecords(recordType: string): boolean {
	return ["MX", "SRV", "TXT", "A", "AAAA", "NS"].includes(recordType);
}

/**
 * Detect potentially problematic duplicate records
 */
export function detectProblematicDuplicates(records: InwxApiRecord[]): Array<{
	name: string;
	type: string;
	records: ExistingInwxRecord[];
	reason: string;
}> {
	const duplicates: Array<{
		name: string;
		type: string;
		records: ExistingInwxRecord[];
		reason: string;
	}> = [];

	const recordGroups = new Map<string, InwxApiRecord[]>();

	// Group records by name + type
	for (const record of records) {
		if (!record || typeof record !== "object") continue;

		const key = `${normalizeRecordName(record.name || "")}|${record.type || ""}`;
		if (!recordGroups.has(key)) {
			recordGroups.set(key, []);
		}
		const group = recordGroups.get(key);
		if (group) {
			group.push(record);
		}
	}

	// Check each group for problematic duplicates
	for (const [key, groupRecords] of recordGroups) {
		if (groupRecords.length <= 1) continue;

		const [name, type] = key.split("|");

		// Convert to ExistingInwxRecord format
		const existingRecords = groupRecords.map(createExistingInwxRecord);

		// Check for problematic patterns
		if (type === "TXT" && name.startsWith("_dmarc.")) {
			// DMARC records with conflicting policies
			const policies = existingRecords
				.map((r) => {
					const match = r.content.match(/p=([^;]+)/);
					return match ? match[1] : null;
				})
				.filter(Boolean);

			if (new Set(policies).size > 1) {
				duplicates.push({
					name,
					type,
					records: existingRecords,
					reason: `Conflicting DMARC policies: ${policies.join(", ")}`,
				});
			}

			// Also check for identical DMARC records (even with same policy)
			const contents = existingRecords.map((r) => r.content);
			const uniqueContents = new Set(contents);
			if (contents.length > uniqueContents.size) {
				duplicates.push({
					name,
					type,
					records: existingRecords,
					reason: "Identical DMARC records found",
				});
			}
		} else if (!allowsMultipleRecords(type)) {
			// Record types that shouldn't have duplicates
			duplicates.push({
				name,
				type,
				records: existingRecords,
				reason: `Record type ${type} should not have multiple values`,
			});
		} else if (type === "TXT") {
			// Look for identical TXT records (true duplicates)
			const contents = existingRecords.map((r) => r.content);
			const uniqueContents = new Set(contents);
			if (contents.length > uniqueContents.size) {
				duplicates.push({
					name,
					type,
					records: existingRecords,
					reason: "Identical TXT records found",
				});
			}
		}
	}

	return duplicates;
}

/**
 * Get domain name from domain info object
 */
export function getDomainName(domainInfo: unknown): string | null {
	if (typeof domainInfo === "string") return domainInfo;
	if (typeof domainInfo === "object" && domainInfo !== null && "domain" in domainInfo) {
		return String((domainInfo as { domain: unknown }).domain);
	}
	return null;
}

/**
 * Convert raw record data to DNS record
 */
export function convertRawRecordToDnsRecord(record: unknown): DnsRecord | null {
	if (!isDnsRecord(record)) return null;

	return {
		qname: String(record.qname),
		rtype: String(record.rtype),
		value: String(record.value),
		explanation: record.explanation ? String(record.explanation) : undefined,
	};
}

/**
 * Type guard for DNS record objects
 */
export function isDnsRecord(
	record: unknown,
): record is { qname: unknown; rtype: unknown; value: unknown; explanation?: unknown } {
	return typeof record === "object" && record !== null && "qname" in record && "rtype" in record && "value" in record;
}

/**
 * Convert INWX record to DNS record format
 */
export function convertInwxRecordToDnsRecord(record: InwxApiRecord): DnsRecord {
	const dnsRecord: DnsRecord = {
		qname: record.name || "",
		rtype: record.type || "",
		value: record.content || "",
	};

	return dnsRecord;
}
