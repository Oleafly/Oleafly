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
