import { beforeEach, describe, expect, it } from "vitest";
import { useFilesStore } from "@/store/files";
import { bufferContent } from "./acp-buffers";

describe("editor buffers for agents", () => {
  beforeEach(() => {
    useFilesStore.setState({
      projectId: "p",
      files: { "main.tex": { content: "unsaved text", dirty: true } },
    } as Partial<ReturnType<typeof useFilesStore.getState>>);
  });

  it("answers with the open editor content of the same project", () => {
    expect(bufferContent("p", "main.tex")).toBe("unsaved text");
  });

  it("answers null for another project or a file that is not open", () => {
    expect(bufferContent("q", "main.tex")).toBeNull();
    expect(bufferContent("p", "refs.bib")).toBeNull();
  });
});
