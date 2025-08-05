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

			const domains = domainsResponse.resData?.domains;
			if (!domains || !Array.isArray(domains)) {
				break; // No more domains
			}

			// Add domains from this page
			const domainNames = domains.map((domain: { domain: string }) => domain.domain);
			allDomains.push(...domainNames);

			// If we got fewer domains than the page limit, we're done
			if (domains.length < pageLimit) {
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
