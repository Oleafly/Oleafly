// Pure AI helpers for figure generation (no app/store/Tauri deps).

function isModelIdCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 97 && code <= 122) ||
    character === "_" ||
    character === "." ||
    character === ":" ||
    character === "-"
  );
}

function isQwenVisionModel(model: string): boolean {
  let cursor = 0;
  while (cursor < model.length) {
    while (cursor < model.length && !isModelIdCharacter(model[cursor])) cursor += 1;
    const segmentStart = cursor;
    while (cursor < model.length && isModelIdCharacter(model[cursor])) cursor += 1;
    if (segmentStart === cursor) continue;

    const qwen = model.indexOf("qwen", segmentStart);
    if (qwen >= segmentStart && qwen < cursor) {
      const visionMarker = model.indexOf("vl", qwen + "qwen".length);
      if (visionMarker >= 0 && visionMarker < cursor) return true;
    }
  }
  return false;
}

// `inputModalities` comes from the model's catalog metadata when the app has
// it. A model listed with image input counts even when its id matches none of
// the patterns below.
export function modelSupportsVision(
  provider: string,
  model: string,
  inputModalities?: readonly string[],
): boolean {
  if (inputModalities?.includes("image")) return true;
  const m = model.toLowerCase();
  // OpenRouter ids embed the origin (e.g. "google/gemini-...", "openai/gpt-4o").
  if (/gemini/.test(m)) return true;
  if (/gpt-4o|gpt-4\.1|gpt-4-turbo|chatgpt-4o|gpt-[5-9]|o4/.test(m)) return true;
  // Every Claude model from Claude 3 on accepts images ("claude-3-5-sonnet",
  // "claude-opus-5-5", "anthropic/claude-fable-5.1").
  if (/claude-(?:3|[a-z]{1,20}-(?:[4-9]|[1-9]\d))/.test(m)) return true;
  if (/llava|bakllava|(?:^|[-_.])vl\b|vision|moondream|minicpm-v/.test(m))
    return true;
  if (isQwenVisionModel(m)) return true;
  // Gemma 3's 4B, 12B, and 27B variants accept images. The compact 1B model does not.
  if (/gemma3(?!(?::|[-_])?1b\b)/.test(m)) return true;
  if (/^glm-[\d.]+v\b/.test(m)) return true;
  if (provider === "xai" && /vision|grok-[4-9]/.test(m)) return true;
  return false;
}
