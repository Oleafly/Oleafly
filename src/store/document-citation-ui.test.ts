// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentCitationUiStore } from "./document-citation-ui";

beforeEach(() => {
  useDocumentCitationUiStore.setState({
    modeRequest: "search",
    selectionOverride: null,
    bibOverride: null,
  });
});

describe("useDocumentCitationUiStore", () => {
  it("requestDocumentScan switches mode and stores non-empty selection", () => {
    useDocumentCitationUiStore
      .getState()
      .requestDocumentScan("  selected paragraph  ");
    const state = useDocumentCitationUiStore.getState();
    expect(state.modeRequest).toBe("document");
    // Store keeps original text; emptiness is gated by trim.
    expect(state.selectionOverride).toBe("  selected paragraph  ");
  });

  it("requestDocumentScan ignores whitespace-only selection", () => {
    useDocumentCitationUiStore.getState().requestDocumentScan("   \n\t  ");
    expect(useDocumentCitationUiStore.getState().selectionOverride).toBeNull();
    expect(useDocumentCitationUiStore.getState().modeRequest).toBe("document");
  });

  it("requestDocumentScan without selection leaves override null", () => {
    useDocumentCitationUiStore.getState().requestDocumentScan();
    const state = useDocumentCitationUiStore.getState();
    expect(state.modeRequest).toBe("document");
    expect(state.selectionOverride).toBeNull();
  });

  it("consumeSelectionOverride returns once then clears", () => {
    useDocumentCitationUiStore.getState().requestDocumentScan("once");
    expect(useDocumentCitationUiStore.getState().consumeSelectionOverride()).toBe(
      "once",
    );
    expect(useDocumentCitationUiStore.getState().consumeSelectionOverride()).toBeNull();
    expect(useDocumentCitationUiStore.getState().selectionOverride).toBeNull();
  });

  it("requestDocumentScan stores non-empty bibOverride", () => {
    useDocumentCitationUiStore
      .getState()
      .requestDocumentScan("sel", "@article{a,\n  title={T},\n}");
    const state = useDocumentCitationUiStore.getState();
    expect(state.bibOverride).toBe("@article{a,\n  title={T},\n}");
  });

  it("requestDocumentScan ignores whitespace-only bibOverride", () => {
    useDocumentCitationUiStore
      .getState()
      .requestDocumentScan("sel", "  \n\t  ");
    expect(useDocumentCitationUiStore.getState().bibOverride).toBeNull();
  });

  it("requestDocumentScan without bibOverride leaves it null", () => {
    useDocumentCitationUiStore.getState().requestDocumentScan("sel");
    expect(useDocumentCitationUiStore.getState().bibOverride).toBeNull();
  });

  it("consumeBibOverride returns once then clears", () => {
    useDocumentCitationUiStore
      .getState()
      .requestDocumentScan(undefined, "@misc{x,}");
    expect(useDocumentCitationUiStore.getState().consumeBibOverride()).toBe(
      "@misc{x,}",
    );
    expect(useDocumentCitationUiStore.getState().consumeBibOverride()).toBeNull();
    expect(useDocumentCitationUiStore.getState().bibOverride).toBeNull();
  });
});
