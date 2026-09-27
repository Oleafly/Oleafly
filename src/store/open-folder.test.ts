import { afterEach, describe, expect, it } from "vitest";
import type { OpenedFolder } from "@/lib/folder-detection";
import { useOpenFolderStore } from "./open-folder";

const opened: OpenedFolder = {
  project_id: "linked-0123456789abcdef0123456789abcdef",
  detection: {
    main: null,
    decision: "ask",
    source: "scan",
    candidates: [
      {
        path: "paper/main.tex",
        family: "latex",
        tier: "s",
        kind: "document",
        class: "article",
        title: "A Paper",
        depth: 1,
        reasons: ["top_level", "named_main"],
      },
    ],
    truncated: false,
    compile_dir: null,
  },
};

describe("useOpenFolderStore", () => {
  afterEach(() => useOpenFolderStore.getState().dismiss());

  it("holds the folder that was just opened until it is dismissed", () => {
    expect(useOpenFolderStore.getState().opened).toBeNull();
    useOpenFolderStore.getState().present(opened);
    expect(useOpenFolderStore.getState().opened).toEqual(opened);
    useOpenFolderStore.getState().dismiss();
    expect(useOpenFolderStore.getState().opened).toBeNull();
  });
});
