import { describe, expect, it } from "vitest";
import { simulateAtsParse } from "./ats-parse";
import { looksLikeResumeSource } from "./doc-type";
import {
  matchResumeSectionHeading,
  normalizeResumeSectionHeading,
} from "./resume-sections";
import { runSourceRules } from "./source-rules";

const PROJECT_PREFIXES = [
  "Personal",
  "Academic",
  "Selected",
  "Key",
  "Notable",
  "Side",
  "Technical",
  "Relevant",
  "Open Source",
  "GitHub",
  "Software",
  "Research",
  "Engineering",
  "Portfolio",
  "Professional",
  "Independent",
  "Freelance",
  "Capstone",
  "Featured",
];

describe("canonical resume section matcher", () => {
  it.each([
    "Project",
    "Projects",
    ...PROJECT_PREFIXES.flatMap((prefix) => [
      `${prefix} Project`,
      `${prefix} Projects`,
    ]),
  ])("recognizes the exact project heading alias %s", (heading) => {
    expect(matchResumeSectionHeading(heading)).toBe("projects");
  });

  it.each([
    "ＧｉｔＨｕｂ　Ｐｒｏｊｅｃｔｓ：",
    "\0GITHUB\u00a0PROJECTS\0",
    "GitHub—Projects",
    "GitHubProjects",
    "  github projects!!!  ",
  ])("normalizes PDF/Unicode heading form %j", (heading) => {
    expect(matchResumeSectionHeading(heading)).toBe("projects");
  });

  it("uses stable NFKC, NUL, whitespace, case and punctuation normalization", () => {
    expect(normalizeResumeSectionHeading("\0ＴＥＣＨＮＩＣＡＬ\u00a0ＳＫＩＬＬＳ：")).toBe(
      "technicalskills",
    );
  });

  it.each([
    "Projects I built at GitHub",
    "My GitHub projects include a compiler",
    "Project management",
    "Research and engineering",
    "Featured project: compiler",
    "The projects section is below",
  ])("does not match prose or broader lookalikes: %s", (heading) => {
    expect(matchResumeSectionHeading(heading)).toBeNull();
  });

  it("drives PDF parsing, source type detection and source heading rules consistently", () => {
    const pdf = simulateAtsParse(
      ["Jane Doe", "jane@example.com", "Experience", "GitHubProjects"].join("\n"),
    );
    expect(pdf.sections.find((section) => section.name === "Projects")?.present).toBe(
      true,
    );

    const source = "\\section{Experience}\\section{GitHub—Projects}";
    expect(looksLikeResumeSource(source)).toBe(true);
    expect(
      runSourceRules(source).some((finding) => finding.id === "nonstandard-headings"),
    ).toBe(false);
  });

  it("still flags a prose-like creative heading inside an identified resume", () => {
    const findings = runSourceRules(
      "\\section{Experience}\\section{Projects I built at GitHub}",
    );
    expect(findings.some((finding) => finding.id === "nonstandard-headings")).toBe(
      true,
    );
  });
});
