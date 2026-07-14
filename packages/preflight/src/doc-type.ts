const RESUME_CLASS = /\\documentclass(?:\[[^\]]*\])?\{\s*(moderncv|altacv|deedy[\w-]*|awesome-cv|[\w-]*resume[\w-]*|[\w-]*cv)\s*\}/i;

const RESUME_HEADING =
  /\\(?:section|subsection|cvsection|resumeSection)\*?\s*\{\s*(experience|work experience|professional experience|education|skills|technical skills|projects|employment)\s*\}/gi;

export function looksLikeResumeSource(text: string): boolean {
  if (RESUME_CLASS.test(text)) return true;
  const matches = text.match(RESUME_HEADING);
  if (!matches) return false;
  // Two or more distinct standard resume headings is a strong signal.
  const distinct = new Set(matches.map((m) => m.toLowerCase().replace(/\s+/g, " ")));
  return distinct.size >= 2;
}
