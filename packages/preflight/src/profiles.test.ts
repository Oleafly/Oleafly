import { describe, expect, it } from "vitest";
import { detectSubmissionProfile, SUBMISSION_PROFILES } from "./profiles";

describe("submission profiles", () => {
  it("detects official IEEE and ACM classes", () => {
    expect(detectSubmissionProfile("\\documentclass[conference]{IEEEtran}")).toBe("ieee");
    expect(detectSubmissionProfile("\\documentclass[sigconf]{acmart}")).toBe("acm");
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
