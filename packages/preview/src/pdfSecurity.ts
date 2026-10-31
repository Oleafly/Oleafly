const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  "https:",
  "http:",
  "mailto:",
  "tel:",
]);

export function safePdfExternalUrl(value: string): string | null {
  const candidate = value.trim();
  if (
    !candidate ||
    /[\u0000-\u001f\u007f]/u.test(candidate) ||
    candidate.length > 8_192
  ) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
      return null;
    }
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.username || parsed.password || !parsed.hostname)
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}
