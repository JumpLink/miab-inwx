# miab-inwx

A TypeScript monorepo for Mail-in-a-Box (MIAB) tools and potential DNS synchronization with INWX.

## Packages

### [@miab-inwx/miab-client](./packages/miab-client)
TypeScript client for the Mail-in-a-Box API, auto-generated using [Hey API](https://heyapi.dev/).

### [@miab-inwx/cli](./apps/cli)
CLI for interacting with Mail-in-a-Box servers.

## Quick Start

```bash
# Install dependencies
yarn install

# Run CLI
cd apps/cli
yarn start --help
```

## Development

```bash
# Install all dependencies
yarn install

# Run CLI from root
yarn workspace @miab-inwx/cli start

# Generate MIAB client
yarn workspace @miab-inwx/miab-client generate
```
