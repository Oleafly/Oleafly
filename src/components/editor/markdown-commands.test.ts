// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { visualLinkHref } from "./markdown-commands";

describe("visualLinkHref", () => {
  it("stores a typed path encoded, without Markdown's angle brackets", () => {
    expect(visualLinkHref("<notes/my plan.md>")).toBe("notes/my%20plan.md");
    expect(visualLinkHref("notes/plan.md#Goals")).toBe("notes/plan.md#Goals");
    expect(visualLinkHref("figures/my plot.png")).toBe("figures/my%20plot.png");
    expect(visualLinkHref("https://oleafly.com")).toBe("https://oleafly.com");
  });

  it("turns a link copied from the preview into a path relative to the note", async () => {
    const { useFilesStore } = await import("@/store/files");
    useFilesStore.setState({ activePath: "notes/index.md", mainDoc: "main.tex" });
    expect(visualLinkHref("tauri://localhost/notes/%D0%A1%D0%B2.md")).toBe("%D0%A1%D0%B2.md");
    expect(visualLinkHref("<http://tauri.localhost/plan.md>")).toBe("../plan.md");
    useFilesStore.setState({ activePath: null });
  });
});
