import { describe, expect, it } from "vitest";
import { detectSubmissionProfile, extractDocumentClass, SUBMISSION_PROFILES } from "./profiles";

describe("submission profiles", () => {
  it("detects official IEEE and ACM classes", () => {
    expect(detectSubmissionProfile("\\documentclass[conference]{IEEEtran}")).toBe("ieee");
    expect(detectSubmissionProfile("\\documentclass[sigconf]{acmart}")).toBe("acm");
  });

  it("detects IEEE, ACM and thesis Typst templates from their imports", () => {
    expect(detectSubmissionProfile('#import "@preview/charged-ieee:0.1.4": ieee')).toBe("ieee");
    expect(detectSubmissionProfile('#import "@preview/clean-acmart:0.0.1": acmart')).toBe("acm");
    expect(detectSubmissionProfile('#import "@preview/modern-wku-thesis:0.1.2": *')).toBe("thesis");
    expect(detectSubmissionProfile('// #import "@preview/charged-ieee:0.1.4": ieee')).toBe("generic");
    expect(detectSubmissionProfile('#import "@preview/cetz:0.3.0": canvas')).toBe("generic");
  });

  it("lists Typst templates only where the catalog has a venue-style template", () => {
    expect(SUBMISSION_PROFILES.ieee.source.recommendedTypstTemplates).toContain("charged-ieee");
    expect(SUBMISSION_PROFILES.acm.source.recommendedTypstTemplates).toContain("clean-acmart");
    expect(SUBMISSION_PROFILES.arxiv.source.recommendedTypstTemplates).toBeUndefined();
    expect(SUBMISSION_PROFILES.thesis.source.recommendedTypstTemplates).toBeUndefined();
  });

  it("extracts a class without regular-expression backtracking", () => {
    expect(extractDocumentClass("before \\documentclass [ draft, onecolumn ] { memoir } after")).toBe("memoir");
    expect(extractDocumentClass("\\documentclass[unfinished")).toBeNull();
    expect(extractDocumentClass("\\documentclass nope \\documentclass{article}")).toBe("article");
  });

  it("keeps venue requirements declarative", () => {
    expect(SUBMISSION_PROFILES.ieee.pdf).toMatchObject({
      requireEmbeddedFonts: true,
      forbidBookmarks: true,
      forbidLinks: true,
      forbidAttachments: true,
    });
    expect(SUBMISSION_PROFILES.arxiv.source.portableFileNames).toBe(true);
  });
});
