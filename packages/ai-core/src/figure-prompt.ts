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

export function modelSupportsVision(provider: string, model: string): boolean {
  const m = model.toLowerCase();
  // OpenRouter ids embed the origin (e.g. "google/gemini-...", "openai/gpt-4o").
  if (/gemini/.test(m)) return true;
  if (/gpt-4o|gpt-4\.1|gpt-4-turbo|chatgpt-4o|gpt-5|o4/.test(m)) return true;
  // Claude 3 and 4 families are all vision-capable.
  if (/claude-3|claude-.{0,40}-4|claude-(sonnet|opus|haiku)-4/.test(m)) return true;
  if (/llava|bakllava|(?:^|[-_.])vl\b|vision|moondream|minicpm-v/.test(m))
    return true;
  if (isQwenVisionModel(m)) return true;
  // Gemma 3's 4B, 12B, and 27B variants accept images. The compact 1B model does not.
  if (/gemma3(?!(?::|[-_])?1b\b)/.test(m)) return true;
  if (/^glm-[\d.]+v\b/.test(m)) return true;
  if (provider === "xai" && /vision/.test(m)) return true;
  return false;
}
