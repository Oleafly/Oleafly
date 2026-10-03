import { beforeEach, describe, expect, it } from "vitest";
import {
  DIAGRAM_COMPOSER_LANGUAGES,
  useDiagramComposerStore,
} from "@/store/diagram-composer";

beforeEach(() => {
  useDiagramComposerStore.setState({ language: "tikz", requestId: 0, chooserOpen: false });
});

describe("diagram composer store", () => {
  it("lists the three composer languages in chooser order", () => {
    expect(DIAGRAM_COMPOSER_LANGUAGES).toEqual(["tikz", "typst", "mermaid"]);
  });

  it("records each requested language with a fresh request id", () => {
    const store = useDiagramComposerStore.getState();
    store.requestLanguage("typst");
    expect(useDiagramComposerStore.getState()).toMatchObject({ language: "typst", requestId: 1 });
    store.requestLanguage("typst");
    expect(useDiagramComposerStore.getState()).toMatchObject({ language: "typst", requestId: 2 });
    store.requestLanguage("mermaid");
    expect(useDiagramComposerStore.getState()).toMatchObject({ language: "mermaid", requestId: 3 });
  });

  it("opens and closes the chooser", () => {
    useDiagramComposerStore.getState().setChooserOpen(true);
    expect(useDiagramComposerStore.getState().chooserOpen).toBe(true);
    useDiagramComposerStore.getState().setChooserOpen(false);
    expect(useDiagramComposerStore.getState().chooserOpen).toBe(false);
  });
});
