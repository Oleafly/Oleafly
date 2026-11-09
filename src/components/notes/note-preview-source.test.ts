import { describe, expect, it } from "vitest";
import { notePreviewSource, PREVIEW_LIMIT } from "./note-preview-source";

const FENCE = "```";

describe("notePreviewSource", () => {
  it("keeps the Markdown body and drops the front matter", () => {
    expect(notePreviewSource("---\ntitle: Runs\nkind: note\n---\n\n## Results\n\nRun 3 reached 64.1%.\n")).toBe(
      "## Results\n\nRun 3 reached 64.1%.",
    );
  });

  it("returns nothing for an empty note", () => {
    expect(notePreviewSource("")).toBe("");
    expect(notePreviewSource("---\ntitle: Empty\n---\n")).toBe("");
  });

  it("leaves out a top heading that only repeats the title", () => {
    expect(notePreviewSource("# Runs\n\nRun 3 reached 64.1%.", "runs")).toBe("Run 3 reached 64.1%.");
    expect(notePreviewSource("# Runs #\nRun 3 reached 64.1%.", "Runs")).toBe("Run 3 reached 64.1%.");
    expect(notePreviewSource("# Other\n\nText", "Runs")).toBe("# Other\n\nText");
    expect(notePreviewSource("## Runs\n\nText", "Runs")).toBe("## Runs\n\nText");
    expect(notePreviewSource("# Runs", "Runs")).toBe("");
    expect(notePreviewSource("# Runs\n\nText", "  ")).toBe("# Runs\n\nText");
  });

  it("joins blocks with one blank line", () => {
    expect(notePreviewSource("One\n\n\n\nTwo\r\n\r\nThree")).toBe("One\n\nTwo\n\nThree");
  });

  it("stops at the last whole block that fits", () => {
    const block = "a".repeat(1400);
    expect(notePreviewSource(`${block}\n\n${block}\n\n${block}`)).toBe(`${block}\n\n${block}`);
  });

  it("keeps a code fence whole even when it holds blank lines", () => {
    const code = `${FENCE}python\nx = 1\n\ny = 2\n${FENCE}`;
    expect(notePreviewSource(`Intro\n\n${code}\n\nAfter`)).toBe(`Intro\n\n${code}\n\nAfter`);
    const tilde = "~~~\na\n\n~~~~\n";
    expect(notePreviewSource(`${tilde}\nNext`)).toBe("~~~\na\n\n~~~~\n\nNext");
    expect(notePreviewSource(`${FENCE}\na\n${FENCE}python\n\nb\n${FENCE}`)).toBe(`${FENCE}\na\n${FENCE}python\n\nb\n${FENCE}`);
  });

  it("keeps an unclosed fence to the end", () => {
    expect(notePreviewSource(`Intro\n\n${FENCE}\nopen\n\nstill code`)).toBe(`Intro\n\n${FENCE}\nopen\n\nstill code`);
  });

  it("cuts a first block that is too long at a line, then at a word", () => {
    const lines = Array.from({ length: 80 }, (_, index) => `| ${index} | ${"x".repeat(40)} |`).join("\n");
    const cut = notePreviewSource(lines);
    expect(cut.length).toBeLessThanOrEqual(PREVIEW_LIMIT);
    expect(lines.startsWith(cut)).toBe(true);
    expect(cut.endsWith("|")).toBe(true);

    const words = "word ".repeat(1000).trim();
    const short = notePreviewSource(words);
    expect(short.endsWith("word…")).toBe(true);
    expect(short.length).toBeLessThanOrEqual(PREVIEW_LIMIT + 1);

    const solid = "x".repeat(PREVIEW_LIMIT + 50);
    expect(notePreviewSource(solid)).toBe(`${"x".repeat(PREVIEW_LIMIT)}…`);
  });
});
