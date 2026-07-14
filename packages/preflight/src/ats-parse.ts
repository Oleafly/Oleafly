import type { Finding } from "./types";

export interface ParsedSection {
  name: string;
  present: boolean;
}

export interface AtsParse {
  isResume: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  links: string[];
  sections: ParsedSection[];
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const URL = /https?:\/\/[^\s|)]+|(?:www\.|linkedin\.com|github\.com)[^\s|)]+/gi;

// Standard resume sections and the patterns a heading line must match.
const SECTIONS: { name: string; re: RegExp }[] = [
  { name: "Experience", re: /^(work |professional |relevant )?experience$|^employment( history)?$/i },
  { name: "Education", re: /^education$/i },
  { name: "Skills", re: /^(technical |core )?skills$|^technologies$/i },
  { name: "Projects", re: /^projects?$/i },
  { name: "Summary", re: /^(summary|objective|profile|about)$/i },
];

function looksLikeName(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 40 || EMAIL.test(t) || /\d/.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w));
}

export function simulateAtsParse(text: string): AtsParse {
  const lines = text.split("\n").map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);

  const email = EMAIL.exec(text)?.[0] ?? null;
  const phone = PHONE.exec(text)?.[0]?.trim() ?? null;
  const links = Array.from(new Set(text.match(URL) ?? []));
  const name = nonEmpty.find(looksLikeName) ?? null;

  const sections = SECTIONS.map((s) => ({
    name: s.name,
    present: lines.some((l) => s.re.test(l)),
  }));

  // A resume is identifiable by its section structure. Two or more standard
  // sections, or contact details plus at least one section, is a strong signal.
  // Deliberately does not require an email, so a missing email can still be
  // flagged on a document that is clearly a resume.
  const presentCount = sections.filter((s) => s.present).length;
  const hasContact = Boolean(email) || Boolean(phone);
  const isResume = presentCount >= 2 || (hasContact && presentCount >= 1);

  return { isResume, name, email, phone, links, sections };
}

export function atsParseFindings(parse: AtsParse): Finding[] {
  if (!parse.isResume) return [];
  const out: Finding[] = [];
  const has = (name: string) => parse.sections.find((s) => s.name === name)?.present;

  if (!parse.email) {
    out.push({
      id: "ats-no-email",
      lens: "ats",
      severity: "error",
      title: "A parser could not find your email",
      detail:
        "No email address was found in the extracted text, which is the field a parser most relies on. If your email sits next to an icon or inside a header, it may not be selectable text. Put it in the body as plain text.",
    });
  }
  if (!parse.phone) {
    out.push({
      id: "ats-no-phone",
      lens: "ats",
      severity: "info",
      title: "A parser could not find a phone number",
      detail:
        "No phone number was found in the extracted text. If it is present but hidden behind an icon or in a header, add it as plain selectable text in the body.",
    });
  }
  if (!has("Experience")) {
    out.push({
      id: "ats-no-experience",
      lens: "ats",
      severity: "warning",
      title: "A parser did not detect a Work Experience section",
      detail:
        "No standard Experience heading was found, so a parser may not group your roles into work history. Use a conventional heading like Experience or Work Experience as real, selectable text.",
    });
  }

  return out;
}
