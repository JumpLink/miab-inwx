# @miab-inwx/miab-client

A TypeScript client library for the Mail-in-a-Box (MIAB) API, automatically generated using [Hey API](https://heyapi.dev/).

## About

This package provides a fully typed TypeScript client for interacting with the Mail-in-a-Box API. It's automatically generated from the official MIAB OpenAPI specification, ensuring compatibility and up-to-date API coverage.

## Features

- 🔧 **Auto-generated** - Generated from the official MIAB OpenAPI specification
- 📘 **Fully Typed** - Complete TypeScript support with type definitions
- 🌐 **Comprehensive** - Covers all MIAB API endpoints
- 🛡️ **Error Handling** - Built-in error handling and validation
- 🔐 **Authentication** - Supports HTTP Basic Authentication
- 📦 **Modern** - Uses native fetch API

## Installation

```bash
yarn add @miab-inwx/miab-client
```

## Usage

### Basic Usage

```typescript
import { MiabClient } from '@miab-inwx/miab-client';

// Configure authentication
const auth = `${email}:${password}`;
const baseUrl = 'https://your-box.example.com/admin';

// Get system status
const statusResponse = await MiabClient.getSystemStatus({
  baseUrl,
  auth,
  throwOnError: true
});

console.log(statusResponse.data);
```

### Available Methods

The client provides methods for all MIAB API endpoints:

#### System Management
- `getSystemStatus()` - Get system status checks
- `getSystemVersion()` - Get installed MIAB version
- `getSystemUpdates()` - Check for system updates
- `getSystemRebootStatus()` - Check if reboot is required
- `rebootSystem()` - Reboot the system

#### DNS Management
- `getDnsZones()` - Get DNS zones
- `getDnsCustomRecords()` - Get custom DNS records
- `addDnsCustomRecord()` - Add custom DNS record
- `updateDnsCustomRecord()` - Update custom DNS record
- `removeDnsCustomRecord()` - Remove custom DNS record

#### Mail Management
- `getMailUsers()` - Get mail users
- `addMailUser()` - Add mail user
- `removeMailUser()` - Remove mail user
- `getMailDomains()` - Get mail domains
- `getMailAliases()` - Get mail aliases

#### SSL Management
- `getSslStatus()` - Get SSL certificate status
- `provisionSslCertificates()` - Provision SSL certificates

#### And many more...

### Error Handling

```typescript
try {
  const response = await MiabClient.getSystemStatus({
    baseUrl,
    auth,
    throwOnError: true
  });
} catch (error) {
  if (error.response?.status === 401) {
    console.error('Authentication failed');
  } else if (error.response?.status === 403) {
    console.error('Access denied');
  } else {
    console.error('API Error:', error.message);
  }
}
```

### Configuration Options

```typescript
const options = {
  baseUrl: 'https://your-box.example.com/admin',
  auth: 'email:password',
  throwOnError: true,  // Throw errors instead of returning them
  headers: {
    'Custom-Header': 'value'
  }
};
```

## API Reference

For detailed API documentation, refer to the [Mail-in-a-Box API documentation](https://mailinabox.email/api-docs.html).

## Generation

This client is automatically generated from the MIAB OpenAPI specification. To regenerate:

```bash
yarn generate
```

This will fetch the latest OpenAPI specification from the MIAB repository and regenerate the client code.

## Generated Files

The `_generated/` directory contains:
- `sdk.gen.ts` - Main SDK with all API methods
- `types.gen.ts` - TypeScript type definitions
- `client.gen.ts` - HTTP client configuration
- `core/` - Core utilities and authentication helpers

## Dependencies

- `@hey-api/client-fetch` - Modern fetch-based HTTP client
- Generated types are compatible with the official MIAB API

## Contributing

Since this is an auto-generated client, contributions should be made to the generation process or the upstream MIAB OpenAPI specification.

## License

This project is licensed under the same terms as the parent project. 