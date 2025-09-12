import type { ApiClient } from "domrobot-client";
import { INWX_SUCCESS_CODE } from "./constants.ts";

/**
 * Fetch all domains from INWX account using pagination
 */
export async function getAllDomains(
	client: ApiClient,
): Promise<{ success: boolean; domains?: string[]; error?: string }> {
	const allDomains: string[] = [];
	let page = 1;
	const pageLimit = 100; // Maximum allowed by INWX API

	try {
		while (true) {
			const domainsResponse = await client.callApi("domain.list", {
				page,
				pagelimit: pageLimit,
			});

			if (domainsResponse.code !== INWX_SUCCESS_CODE) {
				return {
					success: false,
					error: `Failed to list domains (page ${page}): ${domainsResponse.msg}`,
				};
			}

			// API returns resData.domain (singular). Some clients might expose resData.domains – support both.
			const resData = domainsResponse.resData || {};
			const items: unknown[] = Array.isArray((resData as { domain?: unknown[] }).domain)
				? ((resData as { domain: unknown[] }).domain as unknown[])
				: Array.isArray((resData as { domains?: unknown[] }).domains)
					? ((resData as { domains: unknown[] }).domains as unknown[])
					: [];

			if (!items || items.length === 0) {
				break; // No more domains
			}

			// Add domains from this page
			const domainNames = items
				.map((item) => {
					if (typeof item === "string") return item;
					if (item && typeof item === "object" && "domain" in item) return String((item as { domain: unknown }).domain);
					return null;
				})
				.filter((d): d is string => Boolean(d));
			allDomains.push(...domainNames);

			// If we got fewer items than the page limit, we're done
			if (items.length < pageLimit) {
				break;
			}

			page++;
		}

		return {
			success: true,
			domains: allDomains,
		};
	} catch (error) {
		return {
			success: false,
			error: `Error fetching domains: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}
