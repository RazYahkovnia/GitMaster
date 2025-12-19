# GitMaster MCP (v1)

GitMaster exposes **one MCP endpoint** (SSE over localhost), running **inside the GitMaster extension host**.

This is the endpoint you configure in Cursor when you use:

```json
{
  "mcpServers": {
    "GitMaster": {
      "url": "http://127.0.0.1:8765/sse"
    }
  }
}
```

## MCP (SSE over localhost)

### Enable

The MCP server runs **inside the GitMaster extension host**, and is enabled via:

- `gitmaster.mcp.enabled` (default: true)
- `gitmaster.mcp.port` (default: 8765) or env var `GITMASTER_MCP_UI_PORT`

When enabled, GitMaster listens on:

- `http://127.0.0.1:8765/sse`

## Tools

### `gitmaster_shelves_list`

Lists Git stashes (Shelves) including their display name and files with stats.

Input:

- `repoPath` (optional): any file/folder path inside the repo (defaults to workspace/active editor).
- `maxShelves` (optional): default 50.
- `maxFilesPerShelf` (optional): default 500.

### `gitmaster_open_shelves_view`

Focuses GitMaster’s activity bar container and the Shelves view (via `gitmaster.openShelvesView`).

## Cursor config (SSE)

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



