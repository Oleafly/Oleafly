import { latexHeadingTitleBrace } from "@oleafly/latex";
import {
  isAtsResumeSection,
  matchResumeSectionHeading,
} from "./resume-sections";

const RESUME_CLASS = /\\documentclass(?:\[[^\]]{0,500}\])?\{\s{0,20}(deedy[\w-]{0,50}|[\w-]{0,50}resume[\w-]{0,50}|[\w-]{0,50}cv)\s{0,20}\}/i;

const SOURCE_HEADING = /\\(?:section|subsection|cvsection|resumeSection)\*?\s*(?=[[{])/giu;

const SOURCE_TITLE = /\{([^{}]{1,200})\}/uy;

function headingTitle(text: string, from: number): string | undefined {
  const open = latexHeadingTitleBrace(text, from);
  if (open < 0) return undefined;
  SOURCE_TITLE.lastIndex = open;
  return SOURCE_TITLE.exec(text)?.[1];
}

export function looksLikeResumeSource(text: string): boolean {
  if (RESUME_CLASS.test(text)) return true;
  const sections = new Set(
    [...text.matchAll(SOURCE_HEADING)]
      .map((match) => headingTitle(text, match.index + match[0].length))
      .filter((title) => title !== undefined)
      .map(matchResumeSectionHeading)
      .filter(isAtsResumeSection),
  );
  return sections.size >= 2;
}
