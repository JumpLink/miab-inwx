import type { ParsedSrvRecord } from "../types/dns.ts";
import type { DnsRecord, ExistingInwxRecord, RecordComparison } from "../types/migrate-dns.ts";
import { normalizeRecordContent, normalizeRecordsForComparison } from "./dns-helpers.ts";
import { cleanSshfpRecord, parseMxRecord, parseSrvRecord } from "./record-parsers.ts";

/**
 * Compare record names and types
 */
export function compareBasicRecordProperties(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];
	const normalized = normalizeRecordsForComparison(miabRecord, inwxRecord);

	if (normalized.miab.name !== normalized.inwx.name) {
		differences.push(`Name: MIAB="${normalized.miab.name}" vs INWX="${normalized.inwx.name}"`);
	}

	if (miabRecord.rtype !== inwxRecord.type) {
		differences.push(`Type: MIAB="${miabRecord.rtype}" vs INWX="${inwxRecord.type}"`);
	}

	return differences;
}

/**
 * Compare MX record content
 */
export function compareMxRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];
	const miabMx = parseMxRecord(miabRecord.value);

	// Treat null MX (".") with missing/zero priority as equivalent
	const miabIsNullMx = miabMx.content.trim() === ".";
	const inwxIsNullMx = normalizeRecordContent(inwxRecord.content) === ".";
	const inwxPrio = inwxRecord.prio ?? 0;

	if (!(miabIsNullMx && inwxIsNullMx) && miabMx.prio !== inwxPrio) {
		differences.push(`MX Priority: MIAB="${miabMx.prio}" vs INWX="${inwxRecord.prio}"`);
	}

	const normalizedMiabContent = normalizeRecordContent(miabMx.content);
	const normalizedInwxContent = normalizeRecordContent(inwxRecord.content);

	if (normalizedMiabContent !== normalizedInwxContent) {
		differences.push(`MX Content: MIAB="${normalizedMiabContent}" vs INWX="${normalizedInwxContent}"`);
	}

	return differences;
}

/**
 * Compare SRV record basic properties
 */
export function compareSrvRecordBasicProperties(miabSrv: ParsedSrvRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];

	if (miabSrv.prio !== inwxRecord.prio) {
		differences.push(`SRV Priority: MIAB="${miabSrv.prio}" vs INWX="${inwxRecord.prio}"`);
	}

	if (inwxRecord.weight !== undefined && miabSrv.weight !== inwxRecord.weight) {
		differences.push(`SRV Weight: MIAB="${miabSrv.weight}" vs INWX="${inwxRecord.weight}"`);
	}

	if (inwxRecord.port !== undefined && miabSrv.port !== inwxRecord.port) {
		differences.push(`SRV Port: MIAB="${miabSrv.port}" vs INWX="${inwxRecord.port}"`);
	}

	return differences;
}

/**
 * Compare SRV record content when INWX doesn't have separate weight/port fields
 */
export function compareSrvRecordComplexContent(
	miabSrv: ParsedSrvRecord,
	inwxRecord: ExistingInwxRecord,
	normalizedMiabContent: string,
): string[] {
	const differences: string[] = [];
	const inwxParts = inwxRecord.content.trim().split(/\s+/);

	if (inwxParts.length >= 3) {
		// Format: weight port target
		const inwxWeight = parseInt(inwxParts[0], 10);
		const inwxPort = parseInt(inwxParts[1], 10);
		const inwxTarget = inwxParts.slice(2).join(" ").replace(/\.$/, "");

		if (miabSrv.weight !== inwxWeight) {
			differences.push(`SRV Weight: MIAB="${miabSrv.weight}" vs INWX="${inwxWeight}"`);
		}
		if (miabSrv.port !== inwxPort) {
			differences.push(`SRV Port: MIAB="${miabSrv.port}" vs INWX="${inwxPort}"`);
		}
		if (normalizedMiabContent !== inwxTarget) {
			differences.push(`SRV Target: MIAB="${normalizedMiabContent}" vs INWX="${inwxTarget}"`);
		}
	} else if (inwxParts.length === 2) {
		// Format: port target (weight omitted -> assume 0)
		const inwxPort = parseInt(inwxParts[0], 10);
		const inwxTarget = inwxParts[1].replace(/\.$/, "");

		if (miabSrv.port !== inwxPort) {
			differences.push(`SRV Port: MIAB="${miabSrv.port}" vs INWX="${inwxPort}"`);
		}
		if (normalizedMiabContent !== inwxTarget) {
			differences.push(`SRV Target: MIAB="${normalizedMiabContent}" vs INWX="${inwxTarget}"`);
		}
		if (miabSrv.weight !== 0) {
			differences.push(`SRV Weight: MIAB="${miabSrv.weight}" vs INWX="0 (omitted)"`);
		}
	} else {
		differences.push(`Content: MIAB="${miabSrv.content}" vs INWX="${inwxRecord.content}"`);
	}

	return differences;
}

/**
 * Compare SRV record content
 */
export function compareSrvRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];
	const miabSrv = parseSrvRecord(miabRecord.value);

	// Compare basic properties
	differences.push(...compareSrvRecordBasicProperties(miabSrv, inwxRecord));

	// Compare target/content
	const normalizedMiabContent = normalizeRecordContent(miabSrv.content);

	if (inwxRecord.weight !== undefined || inwxRecord.port !== undefined) {
		// INWX provides separate fields -> content is just target
		const normalizedInwxContent = normalizeRecordContent(inwxRecord.content);
		if (normalizedMiabContent !== normalizedInwxContent) {
			differences.push(`SRV Target: MIAB="${normalizedMiabContent}" vs INWX="${normalizedInwxContent}"`);
		}
	} else {
		// INWX encodes weight/port in content -> use robust comparison
		const complexDifferences = compareSrvRecordComplexContent(miabSrv, inwxRecord, normalizedMiabContent);
		differences.push(...complexDifferences);
	}

	return differences;
}

/**
 * Compare SSHFP record content
 */
export function compareSshfpRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];
	const cleanedMiabValue = cleanSshfpRecord(miabRecord.value);
	const cleanedInwxValue = cleanSshfpRecord(inwxRecord.content);

	if (cleanedMiabValue !== cleanedInwxValue) {
		differences.push(`SSHFP Content: MIAB="${cleanedMiabValue}" vs INWX="${cleanedInwxValue}"`);
	}

	return differences;
}

/**
 * Compare generic record content
 */
export function compareGenericRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): string[] {
	const differences: string[] = [];
	const normalizedMiabValue = normalizeRecordContent(miabRecord.value);
	const normalizedInwxValue = normalizeRecordContent(inwxRecord.content);

	if (normalizedMiabValue !== normalizedInwxValue) {
		differences.push(`Content: MIAB="${normalizedMiabValue}" vs INWX="${normalizedInwxValue}"`);
	}

	return differences;
}

/**
 * Compare record content based on record type
 */
export function compareRecordContent(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): RecordComparison {
	let differences: string[] = [];

	switch (miabRecord.rtype) {
		case "MX":
			differences = compareMxRecordContent(miabRecord, inwxRecord);
			break;
		case "SRV":
			differences = compareSrvRecordContent(miabRecord, inwxRecord);
			break;
		case "SSHFP":
			differences = compareSshfpRecordContent(miabRecord, inwxRecord);
			break;
		default:
			differences = compareGenericRecordContent(miabRecord, inwxRecord);
			break;
	}

	return {
		areEqual: differences.length === 0,
		differences,
	};
}

/**
 * Compare two DNS records to check if they are equal
 */
export function compareRecords(miabRecord: DnsRecord, inwxRecord: ExistingInwxRecord): RecordComparison {
	const basicDifferences = compareBasicRecordProperties(miabRecord, inwxRecord);
	const contentComparison = compareRecordContent(miabRecord, inwxRecord);

	const allDifferences = [...basicDifferences, ...contentComparison.differences];

	return {
		areEqual: allDifferences.length === 0,
		differences: allDifferences,
	};
}
