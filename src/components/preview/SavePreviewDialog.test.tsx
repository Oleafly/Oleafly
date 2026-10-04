// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { SavePreviewDialog } from "./SavePreviewDialog";

const copy = enPreview.save;

function renderDialog(overrides: Partial<Parameters<typeof SavePreviewDialog>[0]> = {}) {
  const props = {
    saveOpen: true,
    closeSave: vi.fn(),
    pdfIsStale: false,
    saveName: "paper.pdf",
    setSaveName: vi.fn(),
    saving: false,
    hasDocument: true,
    submitSavePdf: vi.fn(),
    ...overrides,
  };
  render(<SavePreviewDialog {...props} />);
  return props;
}

describe("SavePreviewDialog", () => {
  it("saves the PDF under the typed name from the button or Enter", () => {
    const props = renderDialog();

    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.getByText(copy.description)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(copy.nameLabel), { target: { value: "final.pdf" } });
    expect(props.setSaveName).toHaveBeenCalledWith("final.pdf");
    fireEvent.keyDown(screen.getByLabelText(copy.nameLabel), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText(copy.nameLabel), { key: "a" });
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.save }));

    expect(props.submitSavePdf).toHaveBeenCalledTimes(2);
  });

  it("names an image save and warns that a stale PDF is not the current revision", () => {
    renderDialog({ isImage: true, pdfIsStale: true });

    expect(screen.getByText(copy.imageTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.staleDescription)).toBeInTheDocument();
  });

  it("blocks saving while a save runs or with nothing to save", () => {
    const props = renderDialog({ saving: true });

    expect(screen.getByRole("button", { name: enCommon.state.saving })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText(copy.nameLabel), { key: "Enter" });
    expect(props.submitSavePdf).not.toHaveBeenCalled();
  });

  it("closes from its close button", () => {
    const props = renderDialog({ hasDocument: false });

    expect(screen.getByRole("button", { name: enCommon.actions.save })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: copy.close }).at(-1) as HTMLElement);

    expect(props.closeSave).toHaveBeenCalled();
  });
});
