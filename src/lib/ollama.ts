import { invoke } from "@tauri-apps/api/core";

// IPv4 loopback literal, not "localhost": Ollama binds 127.0.0.1 by default and
// on Windows "localhost" can resolve to ::1 (IPv6) first and fail to connect.
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

// Calls a Rust command that hits `GET {host}/api/tags`; rejects if Ollama
// isn't running/reachable.
export function listOllamaModels(host: string): Promise<string[]> {
  return invoke<string[]>("ollama_list_models", {
    host: host.trim() || DEFAULT_OLLAMA_HOST,
  });
}

// Whether an `ollama` executable exists on this machine, so the settings panel
// can offer to start it rather than only reporting that nothing is listening.
export function ollamaInstalled(): Promise<boolean> {
  return invoke<boolean>("ollama_installed");
}

// Spawns `ollama serve`. Resolves once the process starts; the caller re-checks
// reachability, since the server needs a moment to bind its port.
export function startOllama(): Promise<void> {
  return invoke<void>("ollama_start");
}
