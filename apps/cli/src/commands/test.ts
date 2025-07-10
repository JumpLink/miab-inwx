import type { Argv } from 'yargs';
import type { MiabConnectionOptions } from '../types/index.ts';
import { testMiabConnection } from '../actions/miab.ts';

interface TestOptions extends MiabConnectionOptions {
  // Additional test-specific options can be added here
}

export function testCommand(yargs: Argv): void {
  yargs.command<TestOptions>({
    command: 'test',
    describe: 'Test the connection to the Mail-in-a-Box server',
    builder: (yargs: Argv) => {
      return yargs
        .option('api-url', {
          alias: 'u',
          type: 'string',
          description: 'MIAB API URL',
          demandOption: true
        })
        .option('email', {
          alias: 'e',
          type: 'string',
          description: 'MIAB admin email',
          demandOption: true
        })
        .option('password', {
          alias: 'p',
          type: 'string',
          description: 'MIAB admin password',
          demandOption: true
        })
        .option('verbose', {
          type: 'boolean',
          description: 'Enable verbose output',
          default: false
        })
        .example('$0 test -u https://box.example.com -e admin@example.com -p password', 'Test MIAB server connection');
    },
    handler: async (args: TestOptions) => {
      const result = await testMiabConnection({
        apiUrl: args.apiUrl,
        email: args.email,
        password: args.password,
        verbose: args.verbose
      });

      if (result.success) {
        console.log(`✅ ${result.message}`);
        if (args.verbose && result.data) {
          console.log('Connection Details:');
          console.log(`  Server URL: ${result.data.baseUrl}`);
          console.log(`  Version: ${result.data.version}`);
          console.log(`  Authenticated: ${result.data.authenticated}`);
          console.log(`  Timestamp: ${result.data.timestamp}`);
        }
      } else {
        console.error(`❌ ${result.error}`);
        process.exit(1);
      }
    }
  });
} 