# azure-artifacts-auth-check

CLI for checking Azure DevOps Artifacts npm feeds. It verifies stored credentials, prompts for a PAT when required, writes the necessary entries to `~/.npmrc`, and keeps the project `.npmrc` scoped registry settings up to date.

## Installation

Use `npx` for one-off runs:

```bash
npx azure-artifacts-auth-check
```

Or install globally:

```bash
npm install -g azure-artifacts-auth-check
```

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
  --silent               Suppress normal output (only prints when action is required)
  --help                 Show usage information
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

## What the CLI Does

1. Locates `azure-feed.config.json` and resolves the feed metadata.
2. Ensures scoped registry mappings exist in your project `.npmrc`.
3. Checks `~/.npmrc` for stored credentials per feed.
4. Runs `npm view` against each feed to verify authentication.
5. Prompts for a PAT and updates `~/.npmrc` when authentication fails or credentials are missing.

A 404 during the probe is treated as success—only 401/403 errors keep the feed on the remediation list.

## PAT Requirements

Use the Azure DevOps UI to create a Personal Access Token with **Packaging → Read** scope. The CLI will base64 encode the token correctly (no leading colon) before writing to `~/.npmrc`.

## License

[MIT](./LICENSE)
