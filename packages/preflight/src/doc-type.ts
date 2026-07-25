import {
  isAtsResumeSection,
  matchResumeSectionHeading,
} from "./resume-sections";

const RESUME_CLASS = /\\documentclass(?:\[[^\]]{0,500}\])?\{\s{0,20}(moderncv|altacv|deedy[\w-]{0,50}|awesome-cv|[\w-]{0,50}resume[\w-]{0,50}|[\w-]{0,50}cv)\s{0,20}\}/i;

const SOURCE_HEADING =
  /\\(?:section|subsection|cvsection|resumeSection)\*?\s*\{([^{}]{1,200})\}/giu;

export function looksLikeResumeSource(text: string): boolean {
  if (RESUME_CLASS.test(text)) return true;
  const sections = new Set(
    [...text.matchAll(SOURCE_HEADING)]
      .map((match) => matchResumeSectionHeading(match[1]))
      .filter(isAtsResumeSection),
  );
  // Two or more distinct standard resume headings is a strong signal.
  return sections.size >= 2;
}
