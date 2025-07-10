# @miab-inwx/cli

A TypeScript CLI application for interacting with the Mail-in-a-Box (MIAB) API. This is part of the miab-inwx project for synchronizing MIAB DNS entries with INWX nameserver.

## Structure

```
src/
├── index.ts          # Main CLI entry point
├── types/            # TypeScript types and interfaces
│   ├── index.ts      # Common types
│   └── commands.ts   # Command-specific types
├── commands/         # CLI command definitions
│   ├── index.ts      # Command exports
│   └── status.ts     # Status command
└── actions/          # Business logic and API interactions
    ├── index.ts      # Action exports
    └── miab.ts       # MIAB API actions
```

## Installation

This package is part of the miab-inwx monorepo. Install dependencies from the root:

```bash
# From the root directory
yarn install
```

## Development

Run the CLI in development mode:

```bash
# From the CLI directory
yarn start --help

# Or from the root directory
yarn workspace @miab-inwx/cli start --help
```

**Note:** The CLI uses Node.js experimental TypeScript features internally, but must be run through Yarn to resolve workspace dependencies correctly.

## Usage

### Status Command

Check the status of a Mail-in-a-Box server:

```bash
yarn start status -u https://box.example.com -e admin@example.com -p password
```

With verbose output:

```bash
yarn start status -u https://box.example.com -e admin@example.com -p password --verbose
```

## Running

The CLI runs TypeScript directly using Node.js experimental TypeScript features (no build step required):

```bash
# Run the CLI (preferred method)
yarn start

# Or using the global binary (after installing the package)
miab-cli
```

**Technical Note:** The CLI uses Node.js with `--experimental-strip-types` and `--experimental-transform-types` flags to execute TypeScript directly without a build step.

## Available Commands

- `status` - Check the comprehensive status of the Mail-in-a-Box server
- `test` - Test the connection and authentication to the Mail-in-a-Box server

## Command Examples

### Status Command
```bash
# Basic status check
yarn start status -u https://box.example.com -e admin@example.com -p password

# Verbose status with detailed information
yarn start status -u https://box.example.com -e admin@example.com -p password --verbose
```

### Test Command
```bash
# Test connection
yarn start test -u https://box.example.com -e admin@example.com -p password

# Test with verbose output
yarn start test -u https://box.example.com -e admin@example.com -p password --verbose
```

## Features

- ✅ **Real MIAB API Integration** - Uses the actual Mail-in-a-Box API
- ✅ **Comprehensive Status Checking** - Shows errors, warnings, and OK status
- ✅ **Connection Testing** - Verify connectivity and authentication
- ✅ **Formatted Output** - Clean, readable status reports with emojis
- ✅ **Verbose Mode** - Detailed information when needed
- ✅ **Error Handling** - Proper error messages for different scenarios

## Technical Details

This CLI leverages modern Node.js features:
- **Direct TypeScript Execution**: Uses Node.js experimental TypeScript support (`--experimental-strip-types`, `--experimental-transform-types`)
- **No Build Step**: TypeScript is executed directly without transpilation
- **Yarn Workspaces**: Dependencies are managed through the monorepo workspace
- **MIAB API Integration**: Uses `@miab-inwx/miab-client` for all API communication

## Next Steps

1. ✅ Install dependencies with `yarn install`
2. ✅ Implement actual MIAB API integration in `src/actions/miab.ts`
3. Add more commands as needed (users, domains, SSL, etc.)
4. Add configuration file support for storing credentials
5. Add interactive prompts for sensitive information
6. Implement INWX integration for DNS synchronization

## Contributing

This package is part of the miab-inwx monorepo. Please see the root README for contribution guidelines. 