// Pure AI helpers for figure generation (no app/store/Tauri deps).

export function modelSupportsVision(provider: string, model: string): boolean {
  const m = model.toLowerCase();
  // OpenRouter ids embed the origin (e.g. "google/gemini-...", "openai/gpt-4o").
  if (/gemini/.test(m)) return true;
  if (/gpt-4o|gpt-4\.1|gpt-4-turbo|chatgpt-4o|gpt-5|o4/.test(m)) return true;
  // Claude 3 and 4 families are all vision-capable.
  if (/claude-3|claude-.{0,40}-4|claude-(sonnet|opus|haiku)-4/.test(m)) return true;
  if (/llava|bakllava|-vl\b|vision|moondream|minicpm-v/.test(m)) return true;
  if (/^glm-[\d.]+v\b/.test(m)) return true;
  if (provider === "xai" && /vision/.test(m)) return true;
  return false;
}
