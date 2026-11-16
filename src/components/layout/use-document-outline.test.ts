import { describe, expect, it } from "vitest";
import type { ProjectIndex } from "@/lib/index/types";
import { outlineRoot } from "./use-document-outline";

const include = (file: string, target: string) => ({
  kind: "inputedge",
  name: target,
  target,
  file,
  line: 1,
  from: 0,
  to: 0,
  nameFrom: 0,
  nameTo: 0,
});

const index = {
  defs: [],
  uses: [include("main.tex", "chapters/one.tex"), include("chapters/one.tex", "chapters/table.tex")],
} as unknown as ProjectIndex;

describe("outlineRoot", () => {
  it("roots the file view at the open file", () => {
    expect(outlineRoot("file", index, "chapters/one.tex", "main.tex")).toBe("chapters/one.tex");
  });

  it("roots the document view at the main document from any file it includes, however deep", () => {
    expect(outlineRoot("document", index, "main.tex", "main.tex")).toBe("main.tex");
    expect(outlineRoot("document", index, "chapters/one.tex", "main.tex")).toBe("main.tex");
    expect(outlineRoot("document", index, "chapters/table.tex", "main.tex")).toBe("main.tex");
  });

  it("keeps a file the main document never includes to its own headings", () => {
    expect(outlineRoot("document", index, "notes.tex", "main.tex")).toBe("notes.tex");
  });
});
