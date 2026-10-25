// A provider account's remaining credit, for providers that report it
// (OpenRouter, DeepSeek). Mirrors ProviderCredit in
// src-tauri/src/agent/usage.rs.

export interface ProviderCredit {
  source: string;
  currency: string;
  remaining: number | null;
  limit: number | null;
  used: number | null;
  label: string | null;
  available: boolean | null;
}
