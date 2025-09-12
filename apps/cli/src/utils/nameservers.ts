/**
 * Nameserver classification helpers
 */

export type NameserverCategory = "jumplink" | "box" | "inwx" | "other" | "none";

const INWX_NS_PATTERNS = ["inwx.de", "inwx.com", "inwx.net"];
const BOX_NS_PATTERNS = ["box.mailfreun.de", "mailfreun.de"]; // keep box first to be explicit
const JUMPLINK_NS_PATTERNS = ["jumplink.me"]; // legacy

export function categorizeNameservers(nameservers?: string[]): NameserverCategory {
	if (!nameservers || nameservers.length === 0) return "none";
	const lower = nameservers.map((n) => n.toLowerCase());
	if (matchesAny(lower, JUMPLINK_NS_PATTERNS)) return "jumplink";
	if (matchesAny(lower, BOX_NS_PATTERNS)) return "box";
	if (matchesAny(lower, INWX_NS_PATTERNS)) return "inwx";
	return "other";
}

function matchesAny(values: string[], substrings: string[]): boolean {
	for (const v of values) {
		for (const s of substrings) {
			if (v.includes(s)) return true;
		}
	}
	return false;
}
