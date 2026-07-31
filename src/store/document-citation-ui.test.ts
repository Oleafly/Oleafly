// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentCitationUiStore } from "./document-citation-ui";

beforeEach(() => {
  useDocumentCitationUiStore.setState({
    modeRequest: "search",
    selectionOverride: null,
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
});
