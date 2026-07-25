const EMAIL = /[\w.+-]{1,100}@[\w-]{1,100}\.[\w.-]{1,100}/;

// Deliberately requires either a conventional grouped number or 10-15
// contiguous digits. Candidate validation below rejects year ranges and other
// numeric résumé content before it can masquerade as a phone number.
const PHONE_CANDIDATE =
  /(?<![\p{L}\p{N}])(?:tel\s*:\s*)?(?:(?:\+\d{1,3}[ \t\u00a0.-]*)?(?:\(\s*\d{1,5}\s*\)|\d{1,5})(?:[ \t\u00a0.-]+\d{1,8}){1,6}|\+?\d{10,15})(?:[ \t\u00a0]*(?:x|ext\.?|extension)[ \t\u00a0]*\d{1,6})?(?![\p{L}\p{N}])/giu;

const DATE_RANGE = /^\d{4}(?:\s*[-–—.]\s*\d{2,4}){1,3}$/u;
const CALENDAR_DATE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/u;
const GPA = /^\d(?:\.\d+)?\s*\/\s*\d(?:\.\d+)?$/u;

export function extractEmail(text: string): string | null {
  return EMAIL.exec(text)?.[0] ?? null;
}

export function extractPhoneNumber(text: string): string | null {
  const normalized = text.normalize("NFKC").replaceAll("\0", "");
  for (const match of normalized.matchAll(PHONE_CANDIDATE)) {
    const candidate = match[0].trim();
    const withoutScheme = candidate.replace(/^tel\s*:\s*/iu, "");
    const withoutExtension = withoutScheme.replace(
      /[ \t\u00a0]*(?:x|ext\.?|extension)[ \t\u00a0]*\d{1,6}$/iu,
      "",
    );
    const compact = withoutExtension.trim();
    if (DATE_RANGE.test(compact) || CALENDAR_DATE.test(compact) || GPA.test(compact)) {
      continue;
    }
    const openParens = compact.match(/\(/gu)?.length ?? 0;
    const closeParens = compact.match(/\)/gu)?.length ?? 0;
    if (openParens !== closeParens || openParens > 1) continue;

    const digits = compact.replace(/\D/gu, "");
    if (digits.length < 10 || digits.length > 15) continue;
    if (/^(\d)\1+$/u.test(digits)) continue;
    return withoutScheme.trim();
  }
  return null;
}

export function containsContactToken(text: string): boolean {
  return (
    extractEmail(text) !== null ||
    /mailto\s*:/iu.test(text) ||
    extractPhoneNumber(text) !== null
  );
}
