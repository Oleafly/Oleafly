import type { Finding } from "./types";
import { extractEmail, extractPhoneNumber } from "./contact";
import {
  ATS_SECTION_DEFINITIONS,
  matchResumeSectionHeading,
} from "./resume-sections";

export interface ParsedSection {
  name: string;
  present: boolean;
  required: boolean;
}

export interface AtsParse {
  isResume: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  links: string[];
  sections: ParsedSection[];
}

const URL = /https?:\/\/[^\s|)]+|(?:www\.|linkedin\.com|github\.com)[^\s|)]+/gi;

function looksLikeName(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 40 || extractEmail(t) || /\d/.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w));
}

export function simulateAtsParse(text: string): AtsParse {
  const lines = text.split("\n").map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);

  const email = extractEmail(text);
  const phone = extractPhoneNumber(text);
  const links = Array.from(new Set(text.match(URL) ?? []));
  const name = nonEmpty.find(looksLikeName) ?? null;
  const matchedSections = new Set(lines.map(matchResumeSectionHeading).filter(Boolean));

  const sections = ATS_SECTION_DEFINITIONS.map((section) => ({
    name: section.name,
    present: matchedSections.has(section.id),
    required: section.required,
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
