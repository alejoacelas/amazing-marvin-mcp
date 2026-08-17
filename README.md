# Amazing Marvin

Use Amazing Marvin from ChatGPT Desktop or Claude Desktop through a local MCP server.

## Connect with Claude Desktop

1. [Download `amazing-marvin.mcpb`](https://github.com/alejoacelas/amazing-marvin-mcp/releases/latest/download/amazing-marvin.mcpb).
2. Click the downloaded file to open it in Claude Desktop.
3. Paste `API_TOKEN` from **Amazing features → Integrations → API**. Do not use `FULL_ACCESS_TOKEN`.

The extension includes its JavaScript runtime dependencies. It needs no Git, Python,
Homebrew, npm, terminal or hosted service. It currently supports macOS.

## Connect ChatGPT Desktop

Install [Node.js 20 or later](https://nodejs.org/en/download), then add a custom MCP
server with these fields:

- **Name:** `Amazing Marvin`
- **Type:** `STDIO`
- **Command to launch:** `npx --yes github:alejoacelas/amazing-marvin-mcp#v0.3.2`
- **Environment variable:** `AMAZING_MARVIN_API_TOKEN` = the limited `API_TOKEN` from
  **Amazing features → Integrations → API**

Leave arguments, environment-variable passthrough and working directory blank. Save
the server, enable it in a new chat, and ask: “Test my Amazing Marvin connection.”
Do not use `FULL_ACCESS_TOKEN`.

`npx` downloads this repository and starts its MCP server; the user does not need to
clone it or find `server.js`. The API token remains necessary because Amazing Marvin
does not provide delegated sign-in for this API.

## Install from source

```bash
git clone https://github.com/alejoacelas/amazing-marvin-mcp.git
cd amazing-marvin-mcp
npm ci
```

Configure an MCP client to run `node /absolute/path/to/amazing-marvin-mcp/server.js`
with `AMAZING_MARVIN_API_TOKEN` set to the limited token. Set
`AMAZING_MARVIN_ENABLE_BETA_READS=true` to expose the optional experimental reads.

## Tools

Nine tools use endpoints Amazing Marvin labels stable:

- test the token;
- read scheduled work, due work, categories, labels, goals and the tracked item;
- create tasks and projects.

The installer’s **Enable experimental features** switch adds five tested reads:
account identity, direct open children, time blocks, tracking history and kudos. See
[endpoint support](docs/endpoint-support.md) for measured behavior and exclusions.

## Data and access

The extension runs locally, but tool results enter the Claude conversation. The
limited token grants broad Marvin read access plus task and project creation. Claude
Desktop masks the token; this server never logs it. Uninstalling the extension does
not revoke the token. Rotate it in Amazing Marvin when needed.

## Develop

```bash
npm ci
npm test
npm run smoke
npm run smoke:legacy
npm audit --omit=dev
./scripts/build.sh
```

The build writes `dist/amazing-marvin-<version>.mcpb`. The construction and release
checks are in [reproduce/README.md](reproduce/README.md).

Amazing Marvin API documentation: [Marvin API wiki](https://github.com/amazingmarvin/MarvinAPI/wiki/Marvin-API).
