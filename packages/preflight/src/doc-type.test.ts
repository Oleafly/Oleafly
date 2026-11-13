import { describe, it, expect } from "vitest";
import { looksLikeResumeSource } from "./doc-type";

describe("looksLikeResumeSource", () => {
  it("detects a resume document class", () => {
    expect(looksLikeResumeSource("\\documentclass{moderncv}")).toBe(true);
    expect(looksLikeResumeSource("\\documentclass{altacv}")).toBe(true);
  });

  it("detects two or more standard resume headings", () => {
    expect(looksLikeResumeSource("\\section{Experience}\\section{Education}")).toBe(true);
    expect(looksLikeResumeSource("\\section[Exp]{Experience}\\section[{Edu}]\n{Education}")).toBe(true);
  });

  it("does not fire on a single resume-ish heading", () => {
    expect(looksLikeResumeSource("\\section{Experience}")).toBe(false);
  });

  it("does not treat a research paper as a resume", () => {
    expect(looksLikeResumeSource("\\documentclass{article}\\section{Introduction}\\section{Methods}")).toBe(false);
  });
});
