# FAQ and troubleshooting

## General

### Do I need an account?
No. Oleafly has no accounts and no login. Install it and write.

### Does it need the internet?
Only to fetch LaTeX packages the first time you use them (or when you add a package you've never used). Turn on Offline mode (Settings → General) to compile with `--only-cached` and never touch the network.

### Where are my files?
Every project is a plain folder under `~/.openleaf/projects/<id>/`, with your `.tex`, `.bib`, images, and a `.git` repo. They're just files, so back them up, copy them, or version-control them however you like.

### Is the PDF output ATS-friendly?
Yes. XeTeX/Tectonic emits real selectable Unicode text with embedded subset fonts. The starter templates follow ATS rules (single column, no table-based layout, linear reading order) so resume parsers extract everything correctly.

---

## Setup and compile

### `pnpm tauri dev` fails to find a compiler sidecar
Run the fetch script first:
```bash
./scripts/fetch-tectonic.sh all
./scripts/fetch-typst.sh all
```
Both pinned, checksum-verified engines land in `src-tauri/binaries/`. Re-run `pnpm tauri dev`.

### A package is missing and the compile errors out
Either turn off Offline mode so Tectonic can fetch it once, or add it to your local cache. Once fetched, it's cached for offline use.

### The macOS build hangs / SIGBUS on Apple Silicon
Use Tectonic ≥ 0.16.9 (the fetch script pins it). Older versions had an arm64 `\setmainfont` crash that's fixed in 0.16.9+.

### Word/HTML/Markdown export is greyed out
Those formats go through [pandoc](https://pandoc.org/installing.html). Install it and restart Oleafly.

---

## GitHub sync

### I don't see a "Connect GitHub" device code
Make sure Device Flow is enabled on your OAuth App (GitHub → Settings → Developer settings → your app → "Enable Device Flow"). If you're using a build with the bundled client ID, that's already set up.

### Push fails with "No remote 'origin'"
Publish the project first (Source Control → Publish to GitHub). Push and Pull are disabled until a remote exists.

### Push says SSH remotes aren't supported
Oleafly authenticates over HTTPS with your token. Use an HTTPS remote (Publish sets this automatically), or paste a PAT under Settings → GitHub → Advanced.

### Can I sync across two computers?
Yes. Push on one, Pull on the other. See [GitHub Sync](github-sync.md).

---

## AI assistant

### Which providers work?
OpenAI, Anthropic, Groq, OpenRouter, DeepSeek, Mistral, xAI, Z.AI, and Ollama (local). See [AI Assistant](ai-assistant.md).

### The AI says it has no key / errors on send
Open Settings → AI Assistant and make sure a provider has a saved key and is Active (blue badge). If you deleted keys, reconnect one.

### Can I run it fully offline?
Yes, use Ollama. Pull a model (`ollama pull llama3.2`), then save the Ollama host in Settings.

---

## Still stuck?

- Search existing [issues](https://github.com/Oleafly/Oleafly/issues).
- The app logs errors to `~/.openleaf/app.log`. Include the relevant snippet when you report.
- Open a new issue with the steps to reproduce and your OS.
