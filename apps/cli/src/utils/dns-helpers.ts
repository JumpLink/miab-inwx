import type { DnsRecord, ExistingInwxRecord } from "../types/migrate-dns.ts";
import type { NormalizedRecord } from "../types/dns.ts";
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
 * Create ExistingInwxRecord from API response record
 */
export function createExistingInwxRecord(record: any): ExistingInwxRecord {
	return {
		id: record.id || "",
		name: record.name || "",
		type: record.type || "",
		content: record.content || "",
		ttl: record.ttl !== undefined ? parseInt(record.ttl, 10) : undefined,
		prio: shouldIncludePriority(record) ? parseInt(record.prio, 10) : undefined,
		weight: shouldIncludeWeight(record) ? parseInt(record.weight, 10) : undefined,
		port: shouldIncludePort(record) ? parseInt(record.port, 10) : undefined,
	};
}

/**
 * Check if record should include priority field
 */
export function shouldIncludePriority(record: any): boolean {
	return (record.type === "MX" || record.type === "SRV") && record.prio !== undefined;
}

/**
 * Check if record should include weight field
 */
export function shouldIncludeWeight(record: any): boolean {
	return record.type === "SRV" && record.weight !== undefined;
}

/**
 * Check if record should include port field
 */
export function shouldIncludePort(record: any): boolean {
	return record.type === "SRV" && record.port !== undefined;
}

/**
 * Find matching record in records array
 */
export function findMatchingRecord(records: any[], miabRecord: DnsRecord): ExistingInwxRecord | null {
	const normalizedMiabName = normalizeRecordName(miabRecord.qname);

	for (const record of records) {
		if (!record || typeof record !== "object") continue;

		const normalizedInwxName = normalizeRecordName(record.name || "");
		const isNameAndTypeMatch = normalizedInwxName === normalizedMiabName && record.type === miabRecord.rtype;

		if (!isNameAndTypeMatch) continue;

		const needsContentMatching = recordTypeNeedsContentMatching(miabRecord.rtype);

		if (needsContentMatching) {
			if (doesRecordContentMatch(miabRecord, record)) {
				return createExistingInwxRecord(record);
			}
		} else {
			return createExistingInwxRecord(record);
		}
	}

	return null;
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
export function convertInwxRecordToDnsRecord(record: any): DnsRecord {
	const dnsRecord: DnsRecord = {
		qname: record.name || "",
		rtype: record.type || "",
		value: record.content || "",
	};

	if (record.ttl) {
		dnsRecord.explanation = `TTL: ${record.ttl}`;
	}

	return dnsRecord;
} 