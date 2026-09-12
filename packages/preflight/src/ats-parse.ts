import { message } from "./messages";
import type { Finding, PdfFacts } from "./types";
import { extractEmail, extractPhoneNumber } from "./contact";
import {
  ATS_SECTION_DEFINITIONS,
  matchResumeSectionHeading,
  type AtsSectionDefinition,
} from "./resume-sections";

export interface ParsedSection {
  id: AtsSectionDefinition["id"];
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
  const firstSection = lines.findIndex((line) => matchResumeSectionHeading(line) !== null);
  const headerLines = firstSection >= 0 ? lines.slice(0, firstSection) : nonEmpty.slice(0, 5);
  const name = headerLines.find(looksLikeName) ?? null;
  const matchedSections = new Set(lines.map(matchResumeSectionHeading).filter(Boolean));

  const sections = ATS_SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
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

export function atsParseFindings(parse: AtsParse, pdf?: PdfFacts): Finding[] {
  if (!parse.isResume) return [];
  const out: Finding[] = [];
  const has = (name: string) => parse.sections.find((s) => s.name === name)?.present;

  if (!parse.name) {
    out.push({
      id: "ats-no-name",
      lens: "ats",
      severity: "error",
      title: message("rules.ats-no-name.title"),
      detail: message("rules.ats-no-name.detail"),
      certainty: "verified",
    });
  }

  if (!parse.email) {
    out.push({
      id: "ats-no-email",
      lens: "ats",
      severity: "error",
      title: message("rules.ats-no-email.title"),
      detail: message("rules.ats-no-email.detail"),
    });
  }
  if (!parse.phone) {
    out.push({
      id: "ats-no-phone",
      lens: "ats",
      severity: "info",
      title: message("rules.ats-no-phone.title"),
      detail: message("rules.ats-no-phone.detail"),
    });
  }
  if (!has("Experience")) {
    out.push({
      id: "ats-no-experience",
      lens: "ats",
      severity: "warning",
      title: message("rules.ats-no-experience.title"),
      detail: message("rules.ats-no-experience.detail"),
    });
  }

  if (pdf && pdf.pageCount > 2) {
    out.push({
      id: "ats-long-resume",
      lens: "ats",
      severity: "info",
      title: message("rules.ats-long-resume.title", { count: pdf.pageCount }),
      detail: message("rules.ats-long-resume.detail"),
      certainty: "advisory",
    });
  }

  return out;
}
