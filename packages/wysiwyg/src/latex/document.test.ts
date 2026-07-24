import { describe, expect, it } from "vitest";
import { joinLatexDocument, splitLatexDocument } from "./document";

describe("splitLatexDocument", () => {
  it("splits preamble from body at \\begin{document}/\\end{document}", () => {
    const source = "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n";
    const split = splitLatexDocument(source);
    expect(split.hasDocumentEnv).toBe(true);
    expect(split.preamble).toBe("\\documentclass{article}\n\\begin{document}\n");
    expect(split.body).toBe("Hello.\n");
    expect(split.suffix).toBe("\\end{document}\n");
  });

  it("reports hasDocumentEnv false when there is no document environment", () => {
    const split = splitLatexDocument("Just text.\n");
    expect(split.hasDocumentEnv).toBe(false);
    expect(split.body).toBe("Just text.\n");
  });
});

describe("joinLatexDocument", () => {
  it("reassembles the original source exactly", () => {
    const source = "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n";
    const split = splitLatexDocument(source);
    expect(joinLatexDocument(split)).toBe(source);
  });
});
