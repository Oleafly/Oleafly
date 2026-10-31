import { invoke } from "@tauri-apps/api/core";

// IPv4 loopback literal, not "localhost": Ollama binds 127.0.0.1 by default and
// on Windows "localhost" can resolve to ::1 (IPv6) first and fail to connect.
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

export function listOllamaModels(host: string): Promise<string[]> {
  return invoke<string[]>("ollama_list_models", {
    host: host.trim() || DEFAULT_OLLAMA_HOST,
  });
}

/** A pulled model and what it can do ("vision", "tools", ...); null when
 * Ollama did not say. `remote` marks an Ollama Cloud model: the local Ollama
 * lists it, but its requests go to another computer. */
export interface OllamaModelInfo {
  name: string;
  capabilities: string[] | null;
  remote?: boolean;
}

// Like listOllamaModels, with each model's capabilities. Older Ollama
// versions are asked per model through /api/show, within a few seconds.
export function listOllamaModelDetails(host: string): Promise<OllamaModelInfo[]> {
  return invoke<OllamaModelInfo[]>("ollama_list_model_details", {
    host: host.trim() || DEFAULT_OLLAMA_HOST,
  });
}

export function ollamaInstalled(): Promise<boolean> {
  return invoke<boolean>("ollama_installed");
}

// Spawns `ollama serve`. Resolves once the process starts; the caller re-checks
// reachability, since the server needs a moment to bind its port.
export function startOllama(): Promise<void> {
  return invoke<void>("ollama_start");
}
