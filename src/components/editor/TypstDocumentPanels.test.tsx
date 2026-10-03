// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";

vi.mock("@/components/editor/DocumentInsightsDialog", () => ({
  DocumentInsightsDialog: ({ onClose }: { onClose: () => void }) => <button type="button" onClick={onClose}>{"insights panel"}</button>,
}));
vi.mock("@/components/editor/DocumentSettingsDialog", () => ({
  DocumentSettingsDialog: () => <p>{"settings panel"}</p>,
}));

import { TypstDocumentPanels } from "./TypstDocumentPanels";

describe("TypstDocumentPanels", () => {
  it("loads the requested panel only while it is open", async () => {
    const { container } = render(<TypstDocumentPanels />);
    expect(container).toBeEmptyDOMElement();
    act(() => useTypstDocumentPanelStore.getState().openPanel("insights"));
    fireEvent.click(await screen.findByText("insights panel"));
    expect(useTypstDocumentPanelStore.getState().panel).toBeNull();
    expect(screen.queryByText("insights panel")).not.toBeInTheDocument();
    act(() => useTypstDocumentPanelStore.getState().openPanel("settings"));
    expect(await screen.findByText("settings panel")).toBeVisible();
    act(() => useTypstDocumentPanelStore.getState().closePanel());
  });
});
