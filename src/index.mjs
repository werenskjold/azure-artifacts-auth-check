import { exec } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createInterface } from 'readline';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import os from 'os';

const execAsync = promisify(exec);

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function resolveConfigPath({ cwd, explicitPath }) {
  const candidates = [];

  if (explicitPath) {
    candidates.push(explicitPath.startsWith('/') ? explicitPath : join(cwd, explicitPath));
  }

  candidates.push(join(cwd, 'azure-feed.config.json'));

  // Fallback to script-adjacent config to support local development of the package itself
  candidates.push(join(PACKAGE_DIR, '..', 'azure-feed.config.json'));

  return candidates.find((candidate) => existsSync(candidate));
}

function normalizeScope(scope) {
  if (!scope) {
    return null;
  }

  return scope.startsWith('@') ? scope : `@${scope}`;
}

function parseRegistryUrl(registryUrl) {
  try {
    const url = new URL(registryUrl);
    const segments = url.pathname.split('/').filter(Boolean);

    let organization;
    let project = null;
    let feed;

    if (url.hostname.endsWith('.pkgs.visualstudio.com')) {
      organization = url.hostname.split('.')[0];
      const packagingIndex = segments.indexOf('_packaging');
      if (packagingIndex === -1 || packagingIndex + 1 >= segments.length) {
        return null;
      }

      if (packagingIndex > 0) {
        project = segments[0];
      }

      feed = segments[packagingIndex + 1];
    } else if (url.hostname === 'pkgs.dev.azure.com') {
      if (segments.length === 0) {
        return null;
      }

      organization = segments[0];
      const packagingIndex = segments.indexOf('_packaging');
      if (packagingIndex === -1 || packagingIndex + 1 >= segments.length) {
        return null;
      }

      if (packagingIndex > 1) {
        project = segments[1];
      }

      feed = segments[packagingIndex + 1];
    } else {
      return null;
    }

    if (!organization || !feed) {
      return null;
    }

    return { organization, project, feed };
  } catch {
    return null;
  }
}

function normalizeFeedConfig(feedConfig, index) {
  const derived = parseRegistryUrl(feedConfig.registryUrl);

  if (!feedConfig.registryUrl || !derived) {
    throw new Error(`Invalid registryUrl for feed at index ${index}.`);
  }

  return {
    organization: feedConfig.organization ?? derived.organization,
    project: feedConfig.project ?? derived.project,
    feed: feedConfig.feed ?? derived.feed,
    registryUrl: feedConfig.registryUrl,
    scope: feedConfig.scope,
    testPackage: feedConfig.testPackage,
  };
}

function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function getRegistryKeys(feed) {
  const url = new URL(feed.registryUrl);
  const registryPath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  const registryKey = `//${url.host}${registryPath}`;

  let feedPath = registryPath;
  if (registryPath.endsWith('/registry/')) {
    feedPath = registryPath.slice(0, -'/registry/'.length);
    if (!feedPath.endsWith('/')) {
      feedPath += '/';
    }
  }

  const feedKey = `//${url.host}${feedPath}`;
  const registryUrlNormalized = `${url.origin}${registryPath}`;

  return { registryKey, feedKey, registryUrlNormalized };
}

function readNpmrc(path) {
  if (!existsSync(path)) {
    return '';
  }
  return readFileSync(path, 'utf8');
}

function writeNpmrc(path, content) {
  writeFileSync(path, content, 'utf8');
}

function hasRegistryCredentials(npmrcContent, feed) {
  const { registryKey, feedKey } = getRegistryKeys(feed);
  const legacyRegistryKey = registryKey.endsWith('/') ? registryKey.slice(0, -1) : registryKey;
  const legacyFeedKey = feedKey.endsWith('/') ? feedKey.slice(0, -1) : feedKey;

  return [registryKey, feedKey, legacyRegistryKey, legacyFeedKey]
    .some((key) => key && npmrcContent.includes(`${key}:_password=`));
}

function hasScopeMapping(npmrcContent, feed) {
  const scope = normalizeScope(feed.scope);
  if (!scope) {
    return true;
  }

  const { registryUrlNormalized } = getRegistryKeys(feed);
  return npmrcContent
    .split('\n')
    .some((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith(`${scope}:registry=`) && trimmed.includes(registryUrlNormalized);
    });
}

function ensureScopeMappingEntry(feed, localNpmrcPath) {
  const scope = normalizeScope(feed.scope);
  if (!scope) {
    return;
  }

  let npmrcContent = readNpmrc(localNpmrcPath);
  const { registryUrlNormalized } = getRegistryKeys(feed);
  const scopeLine = `${scope}:registry=${registryUrlNormalized}`;

  if (npmrcContent.includes(scopeLine)) {
    return;
  }

  if (npmrcContent.length > 0 && !npmrcContent.endsWith('\n')) {
    npmrcContent += '\n';
  }

  npmrcContent += `${scopeLine}\n`;
  writeNpmrc(localNpmrcPath, npmrcContent);
}

function updateNpmrc(feed, pat, npmrcPath) {
  let npmrcContent = readNpmrc(npmrcPath);
  const encodedPat = Buffer.from(pat).toString('base64');
  const { registryKey, feedKey } = getRegistryKeys(feed);

  const feedIdentifiers = [
    `${feed.organization}/_packaging/${feed.feed}`,
    feed.project ? `${feed.project}/_packaging/${feed.feed}` : null,
  ].filter(Boolean);

  const lines = npmrcContent.split('\n');
  const filteredLines = [];
  let inOurFeedSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith(';') && feedIdentifiers.some((id) => line.includes(id))) {
      inOurFeedSection = true;
      continue;
    }

    const isOurFeed = feedIdentifiers.some((id) => line.includes(id));

    if (isOurFeed) {
      continue;
    }

    if (inOurFeedSection && line === '') {
      inOurFeedSection = false;
      continue;
    }

    if (inOurFeedSection && line === 'always-auth=true') {
      inOurFeedSection = false;
      continue;
    }

    inOurFeedSection = false;

    if (line.length > 0 || (filteredLines.length > 0 && filteredLines[filteredLines.length - 1].trim() !== '')) {
      filteredLines.push(lines[i]);
    }
  }

  while (filteredLines.length > 0 && filteredLines[filteredLines.length - 1].trim() === '') {
    filteredLines.pop();
  }

  const authConfig = [
    '',
    `; Azure DevOps authentication for ${feed.organization}/${feed.feed}`,
    `${registryKey}:username=${feed.organization}`,
    `${registryKey}:_password=${encodedPat}`,
    `${registryKey}:email=npm@${feed.organization}.com`,
    `${feedKey}:username=${feed.organization}`,
    `${feedKey}:_password=${encodedPat}`,
    `${feedKey}:email=npm@${feed.organization}.com`,
    ''
  ].join('\n');

  npmrcContent = filteredLines.join('\n') + authConfig;

  if (!npmrcContent.includes('always-auth=true')) {
    npmrcContent += '\nalways-auth=true\n';
  }

  writeNpmrc(npmrcPath, npmrcContent);
}

function resolveProbePackage(feed) {
  const configuredPackage = feed.testPackage?.trim();
  if (configuredPackage) {
    return { name: configuredPackage, expectedMissing: false };
  }

  const scope = normalizeScope(feed.scope);
  if (scope) {
    return { name: `${scope}/__auth-check`, expectedMissing: true };
  }

  return { name: 'azure-auth-check-probe', expectedMissing: true };
}

async function testAuthentication(feed) {
  const probe = resolveProbePackage(feed);

  try {
    await execAsync(`npm view ${probe.name} version --registry=${feed.registryUrl}`, {
      timeout: 10000
    });

    let note;
    if (probe.expectedMissing) {
      note = 'Probe package responded successfully (unexpected).';
    }

    return { ok: true, note, probe: probe.name };
  } catch (error) {
    const output = [error?.stdout, error?.stderr, error?.message]
      .filter(Boolean)
      .join('\n');

    if (output.includes('E404')) {
      return {
        ok: true,
        note: probe.expectedMissing
          ? 'Probe package not found (expected).'
          : `Package ${probe.name} was not found in the feed.`,
        probe: probe.name
      };
    }

    if (output.includes('E401') || output.includes('E403')) {
      return { ok: false, reason: 'unauthorized', probe: probe.name };
    }

    return {
      ok: false,
      reason: 'unknown',
      detail: output.trim(),
      probe: probe.name
    };
  }
}

async function promptForPAT(organization) {
  console.log('\n📝 To create a Personal Access Token (PAT):');
  console.log(`   1. Visit: https://dev.azure.com/${organization}/_usersSettings/tokens`);
  console.log('   2. Click "New Token"');
  console.log('   3. Set a name (e.g., "npm-feed-access")');
  console.log('   4. Under "Scopes", select "Packaging" → "Read"');
  console.log('   5. Set expiration (recommend 1 year or longer)');
  console.log('   6. Click "Create" and copy the token\n');

  const pat = await prompt(`🔑 Paste your PAT for ${organization}: `);

  if (!pat || pat.trim().length === 0) {
    console.error('❌ No token provided. Skipping...');
    return null;
  }

  return pat.trim();
}

function log(message, options) {
  if (!options.silent) {
    console.log(message);
  }
}

function banner(message, options) {
  if (!options.silent) {
    console.log(message);
  }
}

function warn(message, options) {
  if (!options.silent) {
    console.warn(message);
  }
}

function error(message, options) {
  if (options.silent) {
    // Always surface errors, even in silent mode
    console.error(message);
  } else {
    console.error(message);
  }
}

function formatDetail(detail, options) {
  if (!detail) {
    return;
  }
  if (options.silent) {
    console.error(detail);
  } else {
    console.log(`        ${detail.split('\n').map((line) => line.trim()).join('\n        ')}`);
  }
}

function summarizeSilent(feeds) {
  const lines = feeds.map((feed) => ` - ${feed.feed} (${feed.organization}/${feed.project || feed.organization})`);
  console.log('Some feeds require authentication:');
  for (const line of lines) {
    console.log(line);
  }
  console.log('Run without --silent for more details.');
}

export async function run(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath({ cwd, explicitPath: options.configPath });

  if (!configPath) {
    throw new Error('Failed to locate azure-feed.config.json. Place it in your project root or pass --config <path>.');
  }

  const rawConfig = readJson(configPath);
  const feedsInput = Array.isArray(rawConfig.feeds) ? rawConfig.feeds : [rawConfig];
  const feeds = feedsInput.map((feed, index) => normalizeFeedConfig(feed, index));

  if (feeds.length === 0) {
    error('❌ No feeds configured in azure-feed.config.json', options);
    process.exit(1);
  }

  const globalNpmrcPath = options.globalNpmrcPath ?? join(os.homedir(), '.npmrc');
  const localNpmrcPath = options.localNpmrcPath ?? join(cwd, '.npmrc');

  const missingCredentialUrls = new Set();

  const globalNpmrcSnapshot = readNpmrc(globalNpmrcPath);
  if (!globalNpmrcSnapshot) {
    warn('⚠️  No ~/.npmrc file found. Global credentials will be written after successful authentication.\n', options);
    for (const feed of feeds) {
      missingCredentialUrls.add(feed.registryUrl);
    }
  } else {
    const missingCreds = feeds.filter((feed) => !hasRegistryCredentials(globalNpmrcSnapshot, feed));
    if (missingCreds.length > 0) {
      warn('⚠️  Detected feeds without credentials in ~/.npmrc:', options);
      for (const feed of missingCreds) {
        warn(`   • ${feed.registryUrl}`, options);
        missingCredentialUrls.add(feed.registryUrl);
      }
      banner('', options);
    }
  }

  const localNpmrcSnapshot = readNpmrc(localNpmrcPath);
  const missingScopes = feeds.filter((feed) => !hasScopeMapping(localNpmrcSnapshot, feed));
  if (missingScopes.length > 0) {
    warn(`⚠️  Missing scope registry mappings detected in ${localNpmrcPath}. Adding entries:`, options);
    for (const feed of missingScopes) {
      const scope = normalizeScope(feed.scope);
      if (scope) {
        ensureScopeMappingEntry(feed, localNpmrcPath);
        warn(`   • ${scope} → ${feed.registryUrl}`, options);
      }
    }
    banner('', options);
  }

  banner('🚀 Azure DevOps NPM Authentication Check\n', options);
  banner(`📦 Found ${feeds.length} feed(s) to check:\n`, options);

  const feedResults = [];

  for (const feed of feeds) {
    banner(`   • ${feed.feed} (${feed.organization}/${feed.project || feed.organization})`, options);
    banner(`     Registry: ${feed.registryUrl}`, options);

    const needsCredentials = missingCredentialUrls.has(feed.registryUrl);
    const authResult = await testAuthentication(feed);

    if (authResult.ok) {
      const notes = [];
      if (authResult.note) {
        notes.push(authResult.note);
      }
      if (needsCredentials) {
        notes.push('Credentials not stored in ~/.npmrc yet');
      }
      const noteSuffix = notes.length > 0 ? ` (${notes.join('; ')})` : '';
      const icon = needsCredentials ? '⚠️ ' : '✅ ';
      banner(`     ${icon}Authenticated${noteSuffix}\n`, options);
    } else {
      if (authResult.reason === 'unauthorized') {
        banner('     ❌ Authentication failed\n', options);
      } else {
        banner(`     ❌ Request failed (probe: ${authResult.probe})`, options);
        formatDetail(authResult.detail, options);
        banner('', options);
      }
    }

    feedResults.push({ feed, authResult, needsCredentials });
  }

  const failedFeeds = feedResults
    .filter((result) => (!result.authResult.ok && result.authResult.reason === 'unauthorized') || result.needsCredentials)
    .map((result) => result.feed);

  if (failedFeeds.length === 0) {
    if (!options.silent) {
      banner('✅ All feeds authenticated successfully! You\'re ready to go.\n', options);
    }
    return;
  }

  if (options.silent) {
    summarizeSilent(failedFeeds);
  } else {
    banner(`\n⚠️  ${failedFeeds.length} feed(s) need authentication.\n`, options);
  }

  const feedsByOrg = failedFeeds.reduce((acc, feed) => {
    if (!acc[feed.organization]) {
      acc[feed.organization] = [];
    }
    acc[feed.organization].push(feed);
    return acc;
  }, {});

  let allSuccessful = true;

  for (const [organization, orgFeeds] of Object.entries(feedsByOrg)) {
    banner(`\n━━━ ${organization} ━━━`, options);
    banner(`Feeds needing authentication: ${orgFeeds.map((f) => f.feed).join(', ')}\n`, options);

    const pat = await promptForPAT(organization);

    if (!pat) {
      banner(`⏭️  Skipped ${organization}\n`, options);
      allSuccessful = false;
      continue;
    }

    banner(`\n📝 Updating credentials for ${orgFeeds.length} feed(s)...`, options);

    for (const feed of orgFeeds) {
      updateNpmrc(feed, pat, globalNpmrcPath);
      banner(`   ✓ ${feed.feed}`, options);
    }

    banner('\n🔍 Verifying credentials...', options);

    let orgSuccess = true;
    for (const feed of orgFeeds) {
      const verificationResult = await testAuthentication(feed);
      const hasCreds = hasRegistryCredentials(readNpmrc(globalNpmrcPath), feed);

      if (verificationResult.ok && hasCreds) {
        const suffix = verificationResult.note ? ` (${verificationResult.note})` : '';
        banner(`   ✅ ${feed.feed} - authenticated${suffix}`, options);
      } else {
        if (!hasCreds) {
          banner(`   ❌ ${feed.feed} - credentials not written to ~/.npmrc`, options);
        } else if (verificationResult.reason === 'unauthorized') {
          banner(`   ❌ ${feed.feed} - authentication failed`, options);
        } else {
          banner(`   ❌ ${feed.feed} - request failed (probe: ${verificationResult.probe})`, options);
          formatDetail(verificationResult.detail, options);
        }
        orgSuccess = false;
      }
    }

    if (!orgSuccess) {
      error(`\n❌ Some feeds in ${organization} are still failing.`, options);
      error('   Please verify your PAT has the correct permissions.', options);
      error('   Required scope: Packaging (Read)\n', options);
      allSuccessful = false;
    } else {
      banner(`\n✅ All ${organization} feeds authenticated successfully!\n`, options);
    }
  }

  if (allSuccessful) {
    banner('\n🎉 All feeds are now authenticated!\n', options);
  } else {
    if (!options.silent) {
      banner('\n⚠️  Some feeds still need attention. Please check the errors above.\n', options);
    }
    process.exit(1);
  }
}
