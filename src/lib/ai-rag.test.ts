import { describe, expect, it } from "vitest";
import { formatRagContext, type RagChunk } from "./ai-rag";

// Pure format helper; retrieveProjectChunks needs the files store (covered lightly in e2e).

describe("formatRagContext", () => {
  it("returns empty for no chunks", () => {
    expect(formatRagContext([])).toBe("");
  });

  it("includes path and text", () => {
    const chunks: RagChunk[] = [
      {
        path: "main.tex",
        startLine: 1,
        endLine: 10,
        text: "\\section{Introduction}",
        score: 2.5,
      },
    ];
    const s = formatRagContext(chunks);
    expect(s).toContain("main.tex:1-10");
    expect(s).toContain("Introduction");
  });
});
