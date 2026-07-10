# miab-inwx

> ## ⚠️ DEPRECATED — migrated into `leitstand`
>
> These packages and the CLI have been **copied/migrated into the `leitstand` workspace**
> (`projects/leitstand/packages/{miab-client,inwx-client,dns}`) as `@leitstand/miab-client`,
> `@leitstand/inwx-client` and `@leitstand/dns` (the `migrate dns` / MIAB / INWX commands now run
> as `leitstand dns …`). Leitstand is the single control plane going forward. **Use leitstand for
> new work.** This repository is kept only as a reference and will be **removed at the next
> opportunity**. See `projects/leitstand/docs/migration-miab-inwx.md`.

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
