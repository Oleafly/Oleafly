# Integrations

Integrations are opt-in boundaries around the local-first application. Core
editing, indexing, compilation with available local engines, preview, and
preflight do not require an account.

## Supported boundaries

| Integration | Purpose | Boundary |
| --- | --- | --- |
| GitHub | OAuth login, repository listing, publish, push, pull | Network calls use GitHub APIs only after the user connects an account |
| MCP | Expose project tools to external clients | Localhost HTTP with a short-lived bearer token and the same approval model |
| AI providers | Chat, edits, compilation assistance, and figure generation | User-selected hosted provider or local Ollama model; credentials stay local |
| Citation services | DOI, arXiv, and Crossref metadata | Sends the requested identifier or title only |
| Optional downloads | Engines, language servers, templates, fonts, and Pandoc | Checksum or manifest policy applies before installation |
| Update feed | Release metadata and signed artifacts | The embedded updater public key must validate the feed artifact |

## Provider adapter model

AI providers implement the common provider interface in
`packages/ai-core/src/providers.ts`. OpenAI-compatible services supply a base
URL and model catalog; provider-specific UI code does not leak into the editor
or compiler packages.

## Security expectations

- No integration may silently send project files.
- User approval is required for file-changing AI actions.
- OAuth, AI, and MCP credentials use encrypted app-managed storage.
- Network-dependent operations expose offline and unavailable states explicitly.
- External clients cannot bypass the application's file sandbox or approval
  policy through the MCP endpoint.

## Engineering anchors

- `src-tauri/src/github.rs`: OAuth device flow and GitHub API transport.
- `src-tauri/src/citation.rs` and `src-tauri/src/literature.rs`: metadata
  lookups.
- `src-tauri/src/mcp/`: local MCP server.
- `packages/ai-core/`: provider and model abstractions.
- `docs/mcp.md`: protocol-level setup and threat model.
