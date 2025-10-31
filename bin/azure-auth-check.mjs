#!/usr/bin/env node
import process from 'process';
import { run } from '../src/index.mjs';

function printHelp() {
  console.log(`Azure DevOps npm Auth Check\n\nUsage:\n  azure-auth-check [options]\n\nOptions:\n  --config <path>        Path to azure-feed.config.json (defaults to ./azure-feed.config.json)\n  --cwd <path>           Project directory (defaults to current working directory)\n  --global-npmrc <path>  Override path to global ~/.npmrc\n  --local-npmrc <path>   Override path to project .npmrc\n  --silent               Suppress output unless action is required\n  --help                 Show this help message\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        printHelp();
        return;
      case '--config':
        options.configPath = args[++i];
        break;
      case '--cwd':
        options.cwd = args[++i];
        break;
      case '--global-npmrc':
        options.globalNpmrcPath = args[++i];
        break;
      case '--local-npmrc':
        options.localNpmrcPath = args[++i];
        break;
      case '--silent':
        options.silent = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  try {
    await run(options);
  } catch (error) {
    console.error('❌ An error occurred:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
