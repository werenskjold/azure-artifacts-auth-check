# azure-artifacts-auth-check

Cross-platform CLI for authenticating Azure DevOps Artifacts npm feeds.

- **Windows**: Wrapper for [vsts-npm-auth](https://www.npmjs.com/package/vsts-npm-auth) that uses native Windows authentication and Credential Manager
- **macOS/Linux**: Manual PAT-based authentication with guided setup

The tool verifies stored credentials, handles authentication when required, writes the necessary entries to `~/.npmrc`, and keeps the project `.npmrc` scoped registry settings up to date.

## Installation

Use `npx` for one-off runs:

```bash
npx azure-artifacts-auth-check
```

Or install globally:

```bash
npm install -g azure-artifacts-auth-check
```

**Windows users**: On first run, the tool will automatically download and use [vsts-npm-auth](https://www.npmjs.com/package/vsts-npm-auth) via npx (no manual installation needed).

## Usage

Run the CLI inside your project directory (where `azure-feed.config.json` lives):

```bash
azure-artifacts-auth-check
```

To enforce the check before every install, add a preinstall hook in your `package.json`:

```json
{
  "scripts": {
    "preinstall": "azure-artifacts-auth-check --silent"
  }
}
```

Using `--silent` avoids noise during routine installs; the command only prints when credentials need attention.

### Options

```
azure-artifacts-auth-check [options]

Options:
  --config <path>        Path to azure-feed.config.json (defaults to ./azure-feed.config.json)
  --cwd <path>           Project directory (defaults to current working directory)
  --global-npmrc <path>  Override path to global ~/.npmrc
  --local-npmrc <path>   Override path to project .npmrc
  --use-pat              Force PAT authentication (skip vsts-npm-auth on Windows)
  --silent               Suppress normal output (only prints when action is required)
  --help                 Show usage information
```

**Windows Users**: By default, the tool uses `vsts-npm-auth` for native Windows authentication. If you prefer to use PAT-based authentication (like macOS/Linux), add the `--use-pat` flag:

```bash
azure-artifacts-auth-check --use-pat
```

## Configuration

Create an `azure-feed.config.json` file in your project root:

```json
{
  "feeds": [
    {
      "registryUrl": "https://contoso.pkgs.visualstudio.com/Apps/_packaging/Widgets/npm/registry/",
      "scope": "@contoso"
    }
  ]
}
```

Each feed entry supports:

- `registryUrl` *(required)* — Azure DevOps npm feed URL.
- `scope` *(optional but recommended)* — npm scope that maps to the feed.
- `organization`, `project`, `feed` *(optional)* — only needed when you want to override values derived from the URL.
- `testPackage` *(optional)* — package name the CLI should query instead of the synthetic probe.

## How It Works

### Common Steps (All Platforms)

1. Locates `azure-feed.config.json` and resolves the feed metadata.
2. Ensures scoped registry mappings exist in your project `.npmrc`.
3. Checks `~/.npmrc` for stored credentials per feed.
4. Runs `npm view` against each feed to verify authentication.

A 404 during the probe is treated as success—only 401/403 errors trigger authentication.

### Platform-Specific Authentication

#### Windows
When authentication is needed on Windows, the tool (by default):
1. Writes registry URLs to `~/.npmrc` (required by vsts-npm-auth)
2. Invokes `npx vsts-npm-auth -C ~/.npmrc`
3. Prompts for Azure DevOps login using native Windows authentication
4. Stores credentials securely in Windows Credential Manager
5. Verifies all feeds are authenticated

**Benefits**: Native Windows SSO, automatic credential refresh, secure storage in Credential Manager.

**Alternative**: Use `--use-pat` to skip vsts-npm-auth and use PAT-based authentication instead (same flow as macOS/Linux).

#### macOS/Linux
When authentication is needed on macOS or Linux, the tool:
1. Groups feeds by organization
2. Prompts you to create a PAT via the Azure DevOps web UI
3. Accepts your PAT via stdin
4. Base64 encodes the token (no leading colon) and writes to `~/.npmrc`
5. Verifies all feeds are authenticated

## PAT Requirements

**macOS/Linux**: PAT authentication is required. Create a Personal Access Token (PAT) with **Packaging → Read** scope using the Azure DevOps web UI.

**Windows**: By default, PATs are not needed—the tool uses native Windows authentication via vsts-npm-auth. However, if you use the `--use-pat` flag, you'll need to create a PAT just like on macOS/Linux.

The CLI will guide you through the PAT creation process and base64 encode the token correctly (no leading colon) before writing to `~/.npmrc`.

## License

[MIT](./LICENSE)
