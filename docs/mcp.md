# MCP server

Oleafly can act as an MCP (Model Context Protocol) server. Any MCP client (Claude Desktop, Claude Code, Cursor, Grok CLI, and others) can read, edit, search, and compile the project you have open, using the same tools and the same approval prompts as Oleafly's built-in assistant. You do not need an API key in Oleafly for this; the external app brings its own model.

This is useful when you already have a Claude (or similar) subscription and want that chat app to drive Oleafly, without pasting an API key into Settings.

## Enable it

1. Open **Settings → MCP**.
2. Toggle **Enable MCP server** on.

The server runs only while Oleafly is open. It listens on `127.0.0.1` only (this computer), never on the network. When you turn it off or quit Oleafly, the endpoint disappears.

Default port is `5323` (`http://127.0.0.1:5323/mcp`). Change it in Settings if that port is taken.

## Connect your client

Settings shows copy-paste snippets for common clients. Replace `<token>` with the bearer token from Settings (Reveal / Copy), or use the live values when the server is running.

### Claude Code

```bash
claude mcp add --transport http openleaf http://127.0.0.1:5323/mcp --header "Authorization: Bearer <token>"
```

### Claude Desktop

Add to `claude_desktop_config.json` (stdio bridge via `mcp-remote`, because Desktop prefers stdio):

```json
{
  "mcpServers": {
    "openleaf": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "http://127.0.0.1:5323/mcp",
        "--header",
        "Authorization: Bearer <token>",
        "--transport",
        "http-only"
      ]
    }
  }
}
```

### Cursor / VS Code

In `.cursor/mcp.json` (or your client's MCP config):

```json
{
  "mcpServers": {
    "openleaf": {
      "url": "http://127.0.0.1:5323/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

### Grok CLI

In `~/.grok/config.toml`:

```toml
[mcp_servers.openleaf]
url = "http://127.0.0.1:5323/mcp"
headers = { Authorization = "Bearer <token>" }
```

The `mcp.json` file next to your Oleafly data (shown in Settings) contains the same URL and token if you prefer to script your setup. It is written only while the server is running (mode `0600` on Unix) and deleted when the server stops. Treat it like any other local secret.

## What the tools can do

The MCP tool list is registered from the same tool objects as the in-app assistant, so names, descriptions, and schemas stay in lockstep.

### Orientation

| Tool | What it does |
|---|---|
| `get_status` | Oleafly version, open project, main document, last compile status |
| `list_projects` | Projects in your library (id and name) |
| `open_project` | Open a project by id so other tools target it |
| `list_files` | Project file tree |
| `project_map` | Outline, labels, citations, macros, input graph, unresolved refs |
| `search_project` | Search text in the current project |

### Reading

| Tool | What it does |
|---|---|
| `read_file` | Read a project file |
| `get_log` | Last compile log |
| `get_pdf_text` | Text extracted from the compiled PDF |

### Editing

| Tool | What it does |
|---|---|
| `write_file` | Write or overwrite a file |
| `replace_in_file` | Find and replace within a file |
| `create_file` | Create a file or folder |
| `rename_file` | Rename or move a path |
| `delete_file` | Delete a file or folder |
| `set_main_doc` | Set the compile entry document |

### Compile and figures

| Tool | What it does |
|---|---|
| `compile` | Compile the project to PDF |
| `preview_figure` | Compile a figure in isolation; returns a PNG image |
| `insert_figure` | Insert the last previewed figure into the document |
| `load_image` | Load an image from the project for figure work |

### App

| Tool | What it does |
|---|---|
| `toggle_theme` | Toggle light / dark mode |

## Approvals and safety

Your MCP client (Claude Desktop, Claude Code, and others) already asks you to approve tool use on its side before it ever calls Oleafly. Oleafly's own approval is a second, deeper gate that shows the actual change, and it is the one that still protects you after you click "Always allow" in the client. Choose how much of it you want with the **approval policy** in Settings:

- **Confirm every change** (default): every write, rename, and delete shows an approval card in Oleafly (with a red/green diff when content rewrites, a rendered image for figures). The card floats as "External agent request (MCP)".
- **Auto-approve edits, confirm deletes**: writes and renames apply immediately; deletes still show a card. **Always allow writes** on a card sets this for the current session.
- **Trust this connection**: Oleafly never prompts. Your client's own approval is the only gate, deletes included. Use this when your client already confirms every tool call and you want a frictionless flow.
- **Read-only mode** (separate toggle) removes mutating tools from `tools/list` entirely, so an external app can read and compile but never modify files, whatever the policy.
- **Bearer token**: 256-bit random value stored in authenticated encrypted
  local storage under `~/.openleaf/`. `get_config` never sends the token to the
  webview. Only Settings connection info exposes it while the server is
  running.
- **Localhost only**: bind address is `127.0.0.1`. Requests with a browser `Origin` header are rejected, and `Host` must be loopback.
- **No arbitrary paths**: tools only touch the open project under the Oleafly projects directory, through the same sandbox as the built-in tools.

### Why claude.ai in the browser cannot connect

A cloud chat service cannot reach `127.0.0.1` on your machine. Use **Claude Desktop** (or Claude Code, Cursor, etc.) instead. Do not tunnel the MCP port to the public internet: that would let anyone with the URL edit and delete your local project files.

## Troubleshooting

| Symptom | What to try |
|---|---|
| Empty tool list right after launch | The app registers tools a moment after startup. Retry `tools/list`. |
| Port in use | Change the port in Settings → MCP and re-enable. |
| HTTP 401 | Token mismatch (e.g. after Regenerate). Copy the new token into the client. |
| HTTP 403 | Client sent an `Origin` header or a non-loopback `Host`. Use a native MCP client, not a browser tab. |
| Call timed out | Each tool call waits up to **5 minutes** (300 s) for compiles or for you to click Approve. Approve or reject pending cards, or retry. |
| Cannot connect | Oleafly must be running with MCP enabled. The server does not run in the background after quit. |

## Non-goals (for now)

MCP resources, prompts, SSE push notifications, per-tool enable toggles, multi-window routing, tunnel support, and a bundled stdio binary are not in this release.
