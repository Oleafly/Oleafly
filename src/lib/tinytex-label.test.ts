import { describe, expect, it } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { tinytexActionLabel } from "./tinytex-label";

const idle = { installing: false, installPhase: null, progress: null, partialDownloadBytes: 0 };

describe("tinytexActionLabel", () => {
  it("offers the download first, and a resume once part of it is on disk", () => {
    expect(tinytexActionLabel(idle)).toBe(enShell.enginePicker.tinytex.download);
    expect(tinytexActionLabel({ ...idle, partialDownloadBytes: 42_000_000 })).toBe(
      enShell.enginePicker.tinytex.resume.replace("{{megabytes}}", "42"),
    );
  });

  it("shows the running phase over a partial download", () => {
    expect(
      tinytexActionLabel({
        installing: true,
        installPhase: "extract",
        progress: null,
        partialDownloadBytes: 42_000_000,
      }),
    ).toBe(enCore.tinytex.phase.unpacking);
  });
});
