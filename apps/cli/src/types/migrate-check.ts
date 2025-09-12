import type { MiabConnectionOptions } from "./index.ts";
import type { InwxConnectionOptions } from "./inwx-test.ts";
import type { CommandResult } from "./index.ts";

export interface MigrateCheckOptions {
    miab: MiabConnectionOptions;
    inwx: InwxConnectionOptions;
    verbose?: boolean;
    include?: string[];
    exclude?: string[];
}

export interface DomainPresence {
    domain: string;
    existsInInwx: boolean;
    nameservers?: string[];
    nameserverCategory?: "jumplink" | "box" | "inwx" | "other" | "none";
}

export interface MigrateCheckData {
    miab: {
        baseUrl: string;
        username: string;
        authenticated: boolean;
        totalDomains: number;
    };
    inwx: {
        username: string;
        environment: "ote" | "live";
        apiUrl: string;
        authenticated: boolean;
        totalZones: number;
    };
    summary: {
        totalMiabDomains: number;
        presentInInwx: number;
        missingInInwx: number;
        timestamp: string;
        categories: {
            jumplink: number;
            box: number;
            inwx: number;
            other: number;
            none: number;
        };
    };
    domains: DomainPresence[];
}

export type MigrateCheckResult = CommandResult<MigrateCheckData>;


