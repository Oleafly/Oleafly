# MCP server

Oleafly can act as an MCP (Model Context Protocol) server. Any MCP client (Claude Desktop, Claude Code, Cursor, Codex CLI, Grok CLI, and others) can read, edit, search, and compile the project you have open, using the same tools and the same approval prompts as Oleafly's built-in assistant. You do not need an API key in Oleafly for this. The external app brings its own model.

This is useful when you already have a Claude (or similar) subscription and want that chat app to drive Oleafly, without pasting an API key into Settings.

## Enable it

1. Open **Settings → MCP**.
2. Toggle **Enable MCP server** on.

The server runs only while the Oleafly application process is open. It listens
on `127.0.0.1` only (this computer), never on the network. When you turn it off
or quit Oleafly, the endpoint disappears. Native project tools remain available
if the renderer window closes while the application process stays active.

Oleafly prefers port `5323` (`http://127.0.0.1:5323/mcp`). If it is unavailable, the server automatically binds another free local port and saves it for the next launch. Settings shows the active URL. Its restart button reuses the current port when possible or selects another free one.

## Connect your client

Settings shows copy-paste snippets for common clients. Copy the live URL because the selected port may differ from `5323`, then replace `<token>` with the bearer token from Settings (Reveal / Copy).

### Claude Code

```bash
claude mcp add --transport http oleafly http://127.0.0.1:5323/mcp --header "Authorization: Bearer <token>"
```

### Claude Desktop

Add to `claude_desktop_config.json` (stdio bridge via `mcp-remote`, because Desktop prefers stdio):

```json
{
  "mcpServers": {
    "oleafly": {
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
    "oleafly": {
      "url": "http://127.0.0.1:5323/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

### Codex CLI

In `~/.codex/config.toml`:

```toml
[mcp_servers.oleafly]
command = "npx"
args = ["-y", "mcp-remote@latest", "http://127.0.0.1:5323/mcp", "--header", "Authorization: Bearer <token>", "--transport", "http-only"]
```

### Grok CLI

In `~/.grok/config.toml`:

```toml
[mcp_servers.oleafly]
url = "http://127.0.0.1:5323/mcp"
headers = { Authorization = "Bearer <token>" }
```

The `mcp.json` file next to your Oleafly data (shown in Settings) contains the same URL and token if you prefer to script your setup. It is written only while the server is running (mode `0600` on Unix) and deleted when the server stops. Treat it like any other local secret.

## What the tools can do

The MCP tool list is registered from the same tool objects as the in-app
assistant, so names, descriptions, and schemas stay in lockstep. File reads,
listing, and search execute in Rust. File writes, replacement, creation,
renaming, and deletion use the renderer coordinator while a window is active so
dirty editor buffers cannot overwrite an external change. After the renderer
disconnects, writes, replacements, creates, and renames can execute natively
when the approval policy allows them. Deletion always requires a connected
window.

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
| `preview_figure` | Compile a figure in isolation and return a PNG image |
| `insert_figure` | Insert the last previewed figure into the document |
| `load_image` | Load an image from the project for figure work |

### App

| Tool | What it does |
|---|---|
| `toggle_theme` | Toggle light / dark mode |

### Skills

| Tool | What it does |
|---|---|
| `list_skills` | List installed skills with id, name, description, phase, tier, and whether they are enabled |
| `load_skill` | Load one skill's full instructions, its folder path, and its file list |
| `read_skill_file` | Read a reference or script from a skill folder |

## Skills over MCP

An external agent connected over MCP gets the same three skill tools the
built-in assistant uses: `list_skills`, `load_skill`, and `read_skill_file`.
They work without opening a project first, so a client can call `list_skills`
right after connecting. Unlike the file-editing tools above, they also stay
available with no Oleafly renderer window connected. A client sees every valid
skill whatever its switch says in Settings: the `enabled` and `projectEnabled`
state governs which skills Oleafly's own assistant loads by itself, not what an
external client is allowed to read. See [Skills](Skills.md) for the skill
format and the bundled research pack.

Some agents read their skills straight from a local folder instead of calling
tools. For those, the other route is the "Share skills with other agents on
this computer" setting in Settings → AI → Skills. It symlinks every valid
Oleafly skill into that agent's own `skills/` subfolder (`~/.claude/skills`,
`~/.codex/skills`, `~/.agents/skills`, `~/.cursor/skills`, or
`~/.gemini/skills`, whichever of those already exist on this machine), so a
skill written once in Oleafly is available from disk with no MCP connection
involved. Turning the setting off removes the symlinks again.

## Approvals and safety

Your MCP client (Claude Desktop, Claude Code, and others) already asks you to approve tool use on its side before it ever calls Oleafly. Oleafly's own approval is a second, deeper gate that shows the actual change, and it is the one that still protects you after you click "Always allow" in the client. Choose how much of it you want with the **approval policy** in Settings:

- **Confirm every change** (default): every write, rename, and delete shows an approval card in Oleafly (with a red/green diff when content rewrites, a rendered image for figures). The card floats as "External agent request (MCP)".
- **Auto-approve edits, confirm deletes**: writes and renames apply immediately while an Oleafly window owns the renderer session. Deletes still show a card. **Always allow writes** on a card sets this for the current session.
- **Trust this connection**: mutating tools do not prompt, but still require an active Oleafly renderer to enforce the policy. Use this only when you trust the client and its own approval controls.
- **Read-only mode** (separate toggle) removes mutating tools from `tools/list` entirely, so an external app can read and compile but never modify files, whatever the policy.
- **Bearer token**: 256-bit random value stored in authenticated encrypted
  local storage under `~/.oleafly/`. `get_config` never sends the token to the
  webview. Only Settings connection info exposes it while the server is
  running.
- **Localhost only**: bind address is `127.0.0.1`. Requests with a browser `Origin` header are rejected, and `Host` must be loopback.
- **No arbitrary paths**: native tools accept only project-relative paths inside the project last reported by the app. Calls cannot supply another project ID, and the backend never guesses from other library projects.

### Why claude.ai in the browser cannot connect

A cloud chat service cannot reach `127.0.0.1` on your machine. Use **Claude Desktop** (or Claude Code, Cursor, etc.) instead. Do not tunnel the MCP port to the public internet: that would let anyone with the URL edit and delete your local project files.

## Troubleshooting

| Symptom | What to try |
|---|---|
| Empty tool list right after launch | The app registers tools a moment after startup. Retry `tools/list`. |
| Port changed from `5323` | The preferred port was unavailable, so Oleafly selected a free one. Copy the live URL from Settings. |
| HTTP 401 | Token mismatch (e.g. after Regenerate). Copy the new token into the client. |
| HTTP 403 | Client sent an `Origin` header or a non-loopback `Host`. Use a native MCP client, not a browser tab. |
| Call timed out | Each tool call waits up to **5 minutes** (300 s) for compiles or for you to click Approve. Approve or reject pending cards, or retry. |
| Tool requires an active window | The tool mutates state or needs UI context. Open an Oleafly window and retry. Only bounded read-only file tools remain available without the renderer. |
| Cannot connect | The Oleafly application process must be running with MCP enabled. The server does not run after the application quits. |

## Non-goals (for now)

MCP resources, prompts, SSE push notifications, per-tool enable toggles, multi-window routing, tunnel support, and a bundled stdio binary are not in this release.
