# GitMaster MCP (v1)

GitMaster exposes **two MCP endpoints**:

- **Data MCP (stdio)**: read-only tools that talk to git (v1: list Shelves).
- **UI MCP bridge (SSE over localhost)**: UI-only tools that require VS Code extension-host APIs (v1: open/focus Shelves view).

## Data MCP (stdio): `gitmaster_shelves_list`

### Recommended setup (end users)

In VS Code/Cursor:

1. Run `GitMaster: Copy Cursor MCP Config (GitMaster)`
2. Paste the snippet into your Cursor `mcp.json`
3. Restart Cursor / reload MCP servers

### Run

Build GitMaster (so `out/` exists), then run:

```bash
npm run build\npm run mcp:data\n```

### Tool: `gitmaster_shelves_list`

Returns the stash name as shown in the **Shelves** view (`stash.message`) plus its files.

Input:

- `repoPath` (optional): repo root path; defaults to the server process `cwd`.
- `maxShelves` (optional): default 50.
- `maxFilesPerShelf` (optional): default 500.

Output (JSON text):

- `index`: e.g. `stash@{0}`
- `name`: Shelves label (stash message)
- `branch`
- `fileCount`
- `files[]`: `{ path, status, additions, deletions }`

### Cursor config (stdio)

In Cursor, add an MCP server that runs the stdio process:

```json
{
  "mcpServers": {
    "gitmaster-data": {
      "command": "node",
      "args": [
        "<ABS_PATH_TO_INSTALLED_EXTENSION>/out/mcp/server.js"
      ]
    }
  }
}
```

## UI MCP bridge (SSE): `gitmaster_open_shelves_view`

### Enable

The UI bridge runs **inside the GitMaster extension host**, and is enabled via env var:

- `GITMASTER_MCP_UI_PORT=8765`

When enabled, GitMaster listens on:

- `http://127.0.0.1:8765/sse`

### Tool: `gitmaster_open_shelves_view`

Focuses GitMaster’s activity bar container and the Shelves view (via `gitmaster.openShelvesView`).

### Cursor config (SSE)

Configure an MCP server that connects to the SSE endpoint (Cursor MCP supports URL-based servers):

```json
{
  "mcpServers": {
    "gitmaster-ui": {
      "url": "http://127.0.0.1:8765/sse"
    }
  }
}
```

## Direct VS Code command (fallback)

Even without the UI bridge, you can open Shelves via the command:

- `gitmaster.openShelvesView`



