# Reproduce the Amazing Marvin MCP release

The server was implemented against Amazing Marvin's published API, then tested in
three layers:

1. A fake API exercises response shapes, validation, throttling, timeouts and
   secret-free errors.
2. MCP clients exercise current and `2025-06-18` protocol handshakes and every
   packaged tool.
3. A disposable Marvin account confirms direct API and MCP results in the web UI.

Run the repeatable checks and build:

```bash
npm ci
npm test
npm run smoke
npm run smoke:legacy
npm audit --omit=dev
./scripts/build.sh
```

The package exposes `server.js` as the `amazing-marvin-mcp` executable. Verify the
same path ChatGPT Desktop uses before release:

```bash
npm exec --yes --package=. -- amazing-marvin-mcp </dev/null
```

It must exit successfully on stdin EOF without writing non-protocol output. The
README's GitHub `npx` command is pinned to the release tag; update it with each
version.

Before release, extract the exact `.mcpb` into a path containing spaces and Unicode,
run both protocol smokes against its `server.js` with a minimal `PATH`, inspect the
archive for development files and credentials, and install the same bytes in Claude
Desktop. Publish the SHA-256 with the release.

Real-account scripts require `AMAZING_MARVIN_API_TOKEN` in the environment. They do
not print or save it. `smoke:real` writes fixtures; use only a disposable account and
inspect the script before running it. The endpoint evidence and release decisions are
in [docs/endpoint-support.md](../docs/endpoint-support.md).
