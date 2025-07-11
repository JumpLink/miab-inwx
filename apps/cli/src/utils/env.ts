import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "@dotenvx/dotenvx";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface EnvConfig {
	// MIAB configuration
	MIAB_URL?: string;
	MIAB_USERNAME?: string;
	MIAB_PASSWORD?: string;

	// INWX configuration
	INWX_USERNAME?: string;
	INWX_PASSWORD?: string;
	INWX_SHARED_SECRET?: string;
	INWX_ENVIRONMENT?: "ote" | "live";

	// General configuration
	VERBOSE?: string;
}

/**
 * Load environment variables from .env file
 */
export function loadEnvConfig(): EnvConfig {
	// Try multiple locations for .env file
	const possiblePaths = [
		resolve(process.cwd(), ".env"),
		resolve(process.cwd(), "apps/cli/.env"),
		resolve(__dirname, "../../.env"),
		resolve(__dirname, "../../../.env"),
		resolve(__dirname, "../../../../.env"),
	];

	let envPath: string | null = null;
	for (const path of possiblePaths) {
		if (existsSync(path)) {
			envPath = path;
			break;
		}
	}

	if (envPath) {
		// Load the .env file if found
		config({ path: envPath, override: true, quiet: true });
	}

	return {
		MIAB_URL: process.env.MIAB_URL,
		MIAB_USERNAME: process.env.MIAB_USERNAME,
		MIAB_PASSWORD: process.env.MIAB_PASSWORD,
		INWX_USERNAME: process.env.INWX_USERNAME,
		INWX_PASSWORD: process.env.INWX_PASSWORD,
		INWX_SHARED_SECRET: process.env.INWX_SHARED_SECRET,
		INWX_ENVIRONMENT: process.env.INWX_ENVIRONMENT as "ote" | "live",
		VERBOSE: process.env.VERBOSE,
	};
}

/**
 * Debug function to show environment status
 */
export function debugEnvConfig() {
	const possiblePaths = [
		resolve(process.cwd(), ".env"),
		resolve(process.cwd(), "apps/cli/.env"),
		resolve(__dirname, "../../.env"),
		resolve(__dirname, "../../../.env"),
		resolve(__dirname, "../../../../.env"),
	];

	console.log("🔍 Environment Debug Information:");
	console.log(`  Current working directory: ${process.cwd()}`);
	console.log(`  __dirname: ${__dirname}`);
	console.log("");

	console.log("📁 Checking .env file locations:");
	for (const path of possiblePaths) {
		const exists = existsSync(path);
		console.log(`  ${exists ? "✅" : "❌"} ${path}`);
	}

	console.log("");
	console.log("🔧 Environment Variables Status:");
	const env = loadEnvConfig();
	console.log(`  MIAB_URL: ${env.MIAB_URL ? "✅ Set" : "❌ Missing"}`);
	console.log(`  MIAB_USERNAME: ${env.MIAB_USERNAME ? "✅ Set" : "❌ Missing"}`);
	console.log(`  MIAB_PASSWORD: ${env.MIAB_PASSWORD ? "✅ Set" : "❌ Missing"}`);
	console.log(`  INWX_USERNAME: ${env.INWX_USERNAME ? "✅ Set" : "❌ Missing"}`);
	console.log(`  INWX_PASSWORD: ${env.INWX_PASSWORD ? "✅ Set" : "❌ Missing"}`);
	console.log(`  INWX_SHARED_SECRET: ${env.INWX_SHARED_SECRET ? "✅ Set" : "❌ Missing"}`);
	console.log(`  INWX_ENVIRONMENT: ${env.INWX_ENVIRONMENT || "ote"}`);
	console.log(`  VERBOSE: ${env.VERBOSE || "false"}`);
}

/**
 * Get MIAB connection options from environment
 */
export function getMiabConnectionFromEnv() {
	const env = loadEnvConfig();

	if (!env.MIAB_URL || !env.MIAB_USERNAME || !env.MIAB_PASSWORD) {
		throw new Error("Missing required MIAB environment variables: MIAB_URL, MIAB_USERNAME, MIAB_PASSWORD");
	}

	return {
		apiUrl: env.MIAB_URL,
		email: env.MIAB_USERNAME,
		password: env.MIAB_PASSWORD,
		verbose: env.VERBOSE === "true",
	};
}

/**
 * Get INWX connection options from environment
 */
export function getInwxConnectionFromEnv() {
	const env = loadEnvConfig();

	if (!env.INWX_USERNAME || !env.INWX_PASSWORD) {
		throw new Error("Missing required INWX environment variables: INWX_USERNAME, INWX_PASSWORD");
	}

	return {
		username: env.INWX_USERNAME,
		password: env.INWX_PASSWORD,
		sharedSecret: env.INWX_SHARED_SECRET,
		environment: env.INWX_ENVIRONMENT || "ote",
		verbose: env.VERBOSE === "true",
	};
}

/**
 * Validate that all required environment variables are set
 */
export function validateEnvironment(requireMiab = false, requireInwx = false) {
	const env = loadEnvConfig();
	const missing: string[] = [];

	if (requireMiab) {
		if (!env.MIAB_URL) missing.push("MIAB_URL");
		if (!env.MIAB_USERNAME) missing.push("MIAB_USERNAME");
		if (!env.MIAB_PASSWORD) missing.push("MIAB_PASSWORD");
	}

	if (requireInwx) {
		if (!env.INWX_USERNAME) missing.push("INWX_USERNAME");
		if (!env.INWX_PASSWORD) missing.push("INWX_PASSWORD");
	}

	if (missing.length > 0) {
		throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
	}
}

/**
 * Print example .env file content
 */
export function printEnvExample() {
	console.log("Example .env file content:");
	console.log("");
	console.log("# MIAB Configuration");
	console.log("MIAB_URL=https://box.example.com/admin");
	console.log("MIAB_USERNAME=admin@example.com");
	console.log("MIAB_PASSWORD=your-password");
	console.log("");
	console.log("# INWX Configuration");
	console.log("INWX_USERNAME=your-username");
	console.log("INWX_PASSWORD=your-password");
	console.log("INWX_SHARED_SECRET=your-2fa-secret");
	console.log("INWX_ENVIRONMENT=ote");
	console.log("");
	console.log("# General Configuration");
	console.log("VERBOSE=false");
	console.log("");
	console.log("Save this as .env in your project root directory.");
}
