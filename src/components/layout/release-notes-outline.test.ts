import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inAppReleaseNotes, outlineReleaseNotes, releaseSectionFolds } from "./release-notes-outline";
import { splitNotesTitle } from "./ReleaseTimeline";

const FOOTER_043 =
  "---\r\n\r\n**Downloads:** grab your platform's installer below (macOS Apple Silicon `.dmg`, Windows x86_64 `.msi` / `-setup.exe`, Linux x86_64 or ARM64 `.AppImage` / `.deb`).";

describe("inAppReleaseNotes", () => {
  it("drops the GitHub download footer and normalizes line endings", () => {
    expect(inAppReleaseNotes(`### Fixed\r\n\r\n- One.\r\n\r\n${FOOTER_043}`)).toBe("### Fixed\n\n- One.");
  });

  it("drops the 0.4.0 wording with its trailing line break", () => {
    const body =
      "### Fixed\r\n\r\n- One.\r\n\r\n---\r\n\r\n**Downloads:** choose the installer for your platform below: macOS `.dmg`.\r\n";
    expect(inAppReleaseNotes(body)).toBe("### Fixed\n\n- One.");
  });

  it("drops the unlock paragraph that follows the footer in 0.2 releases", () => {
    const body = [
      "### Added",
      "",
      "- One.",
      "",
      "---",
      "",
      "**Downloads:** grab your platform's installer below.",
      "",
      "First launch on macOS or Windows? Follow the [one-time unlock steps](https://example.com).",
      "",
    ].join("\n");
    expect(inAppReleaseNotes(body)).toBe("### Added\n\n- One.");
  });

  it("keeps a rule that is part of the notes", () => {
    const body = "### Added\n\n- One.\n\n---\n\nMore notes after a rule.";
    expect(inAppReleaseNotes(body)).toBe(body);
    expect(inAppReleaseNotes(undefined)).toBe("");
  });
});

describe("splitNotesTitle", () => {
  it("drops the footer and a repeated leading title", () => {
    expect(
      splitNotesTitle(`## What's new in 0.4.0\r\n\r\n## What's new in 0.4.0\r\n\r\n> Save first.\r\n\r\n${FOOTER_043}`),
    ).toEqual({ title: "What's new in 0.4.0", body: "> Save first." });
  });
});

describe("outlineReleaseNotes", () => {
  it("splits the lead from the sections and counts top-level items", () => {
    const outline = outlineReleaseNotes(
      [
        "> Save your work first.",
        "",
        "### Added",
        "",
        "- One that wraps",
        "  onto a second line.",
        "  - A nested point.",
        "- Two.",
        "",
        "### Fixed ###",
        "",
        "```",
        "### not a heading",
        "- not an item",
        "```",
        "* Three.",
      ].join("\n"),
    );
    expect(outline.lead).toBe("> Save your work first.");
    expect(outline.sections.map(({ heading, items }) => [heading, items])).toEqual([
      ["Added", 2],
      ["Fixed", 1],
    ]);
    expect(outline.sections[1].body).toContain("### not a heading");
  });

  it("does not take inline code that starts a line for a code fence", () => {
    const outline = outlineReleaseNotes(
      [
        "### Fixed",
        "",
        "- English spell check no longer marks `students'` as a mistake because of",
        "  the apostrophe at the end, or a word in TeX quotes such as",
        "  ``` ``word'' ```. Words typed with a curly apostrophe, such as don’t or",
        "  Italian dell’anno, are accepted.",
        "- Two.",
        "",
        "### Security",
        "",
        "- One.",
        "- Two.",
      ].join("\n"),
    );
    expect(outline.sections.map(({ heading, items }) => [heading, items])).toEqual([
      ["Fixed", 2],
      ["Security", 2],
    ]);
  });

  it("closes a fence only on a bare run of the same character, at least as long", () => {
    const outline = outlineReleaseNotes(
      [
        "### Fixed",
        "",
        "````md",
        "```",
        "### not a heading",
        "~~~~",
        "```` not a close",
        "````  ",
        "- One.",
        "",
        "~~~",
        "- not an item",
        "```",
        "~~~",
        "- Two.",
      ].join("\n"),
    );
    expect(outline.sections.map(({ heading, items }) => [heading, items])).toEqual([["Fixed", 2]]);
  });

  it("outlines the full 0.4.3 notes with every section", () => {
    const changelog = readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");
    const start = changelog.indexOf("## [0.4.3]");
    const end = changelog.indexOf("\n## [", start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    const notes = changelog.slice(changelog.indexOf("\n", start) + 1, end);
    const outline = outlineReleaseNotes(inAppReleaseNotes(`${notes}\n\n${FOOTER_043}`));
    expect(outline.sections.map(({ heading, items }) => [heading, items])).toEqual([
      ["Added", 8],
      ["Changed", 8],
      ["Fixed", 52],
      ["Security", 4],
    ]);
  });

  it("returns only a lead when the notes have no sections", () => {
    expect(outlineReleaseNotes("See the changelog.")).toEqual({ lead: "See the changelog.", sections: [] });
  });

  it("folds big sections other than Added and Changed", () => {
    expect(releaseSectionFolds({ heading: "Fixed", body: "", items: 52 })).toBe(true);
    expect(releaseSectionFolds({ heading: "Security", body: "", items: 4 })).toBe(true);
    expect(releaseSectionFolds({ heading: "Fixed", body: "", items: 3 })).toBe(false);
    expect(releaseSectionFolds({ heading: "Added", body: "", items: 8 })).toBe(false);
    expect(releaseSectionFolds({ heading: "Changed", body: "", items: 26 })).toBe(true);
  });
});
