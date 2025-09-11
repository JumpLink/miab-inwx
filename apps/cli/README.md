# MIAB CLI Tool

A command-line interface for managing Mail-in-a-Box (MIAB) and INWX operations, including DNS record migration.

## Setup

### 1. Install Dependencies

```bash
yarn install
```

### 2. Configure Environment Variables

Create a `.env` file in your project root directory:

```bash
cp .env.example .env
```

Edit the `.env` file with your actual credentials:

```bash
# MIAB (Mail-in-a-Box) Configuration
MIAB_URL=https://box.example.com/admin
MIAB_USERNAME=admin@example.com
MIAB_PASSWORD=your-miab-password

# INWX Configuration
INWX_USERNAME=your-inwx-username
INWX_PASSWORD=your-inwx-password
INWX_SHARED_SECRET=your-2fa-secret
INWX_ENVIRONMENT=ote

# General Configuration
VERBOSE=false
```

**Important:** Never commit your `.env` file to version control!

## Usage

### Running the CLI

```bash
# From project root
yarn workspace @miab-inwx/cli start <command>

# Or using npm script
npm run start <command>
```

### Available Commands

#### MIAB Commands

```bash
# Test MIAB connection
yarn workspace @miab-inwx/cli start miab test

# Check MIAB status
yarn workspace @miab-inwx/cli start miab status

# Verbose output
yarn workspace @miab-inwx/cli start miab status --verbose
```

#### INWX Commands

```bash
# Test INWX connection
yarn workspace @miab-inwx/cli start inwx test

# Check INWX account status
yarn workspace @miab-inwx/cli start inwx status

# Verbose output
yarn workspace @miab-inwx/cli start inwx status --verbose
```

#### Migration Commands

```bash
# Dry run (test without making changes)
yarn workspace @miab-inwx/cli start migrate dns --dry-run

# Actual migration (OTE by default)
yarn workspace @miab-inwx/cli start migrate dns

# Production migration
yarn workspace @miab-inwx/cli start migrate dns --environment live

# Overwrite conflicts and purge existing records first (keeps SOA/NS)
yarn workspace @miab-inwx/cli start migrate dns --environment live --conflict-resolution=overwrite --purge-existing
```

### Migration Options

- **--environment [ote|live]**: INWX environment (default: `ote`)
- **--conflict-resolution [skip|overwrite|interactive]**:
  - `skip`: keep existing INWX records
  - `overwrite`: replace conflicting records with MIAB values
  - `interactive`: prompt per conflict
- **--purge-existing**: Delete all existing records in the zone before migration (SOA/NS preserved)
- **--include**: Glob patterns for domains to include (default: `*`)
- **--exclude**: Glob patterns for domains to exclude
- **--dry-run**: Show actions without making changes
- **--verbose**: Detailed logs

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MIAB_URL` | MIAB server URL | Yes | - |
| `MIAB_USERNAME` | MIAB admin email | Yes | - |
| `MIAB_PASSWORD` | MIAB admin password | Yes | - |
| `INWX_USERNAME` | INWX username | Yes | - |
| `INWX_PASSWORD` | INWX password | Yes | - |
| `INWX_SHARED_SECRET` | INWX 2FA secret | No | - |
| `INWX_ENVIRONMENT` | INWX environment | No | `ote` |
| `VERBOSE` | Enable verbose output | No | `false` |

### Environment Configuration

- **INWX_ENVIRONMENT**: 
  - `ote` - Testing environment (default)
  - `live` - Production environment

- **VERBOSE**: Set to `true` to enable detailed output for all commands

## Examples

### Testing Connections

```bash
# Test all connections
yarn workspace @miab-inwx/cli start miab test
yarn workspace @miab-inwx/cli start inwx test
```

### DNS Migration Workflow

```bash
# 1. Test connections first
yarn workspace @miab-inwx/cli start miab test
yarn workspace @miab-inwx/cli start inwx test

# 2. Dry run migration (test environment)
yarn workspace @miab-inwx/cli start migrate dns --dry-run

# 3. Actual migration (test environment)
yarn workspace @miab-inwx/cli start migrate dns

# 4. For production (set INWX_ENVIRONMENT=live in .env or --environment live)
yarn workspace @miab-inwx/cli start migrate dns --environment live

# 5. Optional: purge existing records and overwrite conflicts
yarn workspace @miab-inwx/cli start migrate dns --environment live --purge-existing --conflict-resolution=overwrite
```

## SRV Record Handling

- SRV records are created with:
  - Relative name (e.g., `_caldavs._tcp`)
  - Content formatted as `weight port target`
  - Target normalized with a trailing dot during creation
- This matches what the INWX UI stores (and avoids API errors like "Unknown command").

## Error Handling

If you encounter credential or API errors, the CLI will show helpful messages. Use `--verbose` for more details.

## Security Notes

- Never commit your `.env` file to version control
- Use the test environment for trial runs
- Always run `--dry-run` before production migrations
- Keep your credentials secure and rotate them regularly

## Development

To run the CLI in development mode:

```bash
cd apps/cli
node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings ./src/index.ts --help
```
