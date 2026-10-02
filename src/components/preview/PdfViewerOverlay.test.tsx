// @vitest-environment jsdom
import "@/i18n";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import type { PdfLoadState } from "@/components/pdf/PdfViewer";
import { PdfViewerOverlay } from "./PdfViewerOverlay";

const LOCKED_MESSAGE = "This PDF is protected";
const LOADING_TEXT = "Rendering pages";
const SECRET = "open-sesame";

function Harness({
  loadState,
  onSubmitPassword,
}: Readonly<{ loadState: PdfLoadState; onSubmitPassword: (password: string) => void }>) {
  const [draft, setDraft] = useState("");
  return (
    <PdfViewerOverlay
      loadState={loadState}
      passwordDraft={draft}
      onPasswordDraftChange={setDraft}
      onSubmitPassword={() => onSubmitPassword(draft)}
    >
      <p>{LOADING_TEXT}</p>
    </PdfViewerOverlay>
  );
}

describe("PdfViewerOverlay", () => {
  it("shows its content for a load that needs no password", () => {
    render(
      <Harness
        loadState={{ status: "loading", documentIdentity: "doc" }}
        onSubmitPassword={vi.fn()}
      />,
    );
    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
    expect(screen.queryByLabelText(enPreview.password.label)).toBeNull();
  });

  it("asks for a password and submits only once one is typed", async () => {
    const onSubmitPassword = vi.fn();
    render(
      <Harness
        loadState={{ status: "password_required", documentIdentity: "doc", message: LOCKED_MESSAGE }}
        onSubmitPassword={onSubmitPassword}
      />,
    );

    expect(screen.queryByText(LOADING_TEXT)).toBeNull();
    expect(screen.getByText(enPreview.password.title)).toBeInTheDocument();
    expect(screen.getByText(LOCKED_MESSAGE)).toBeInTheDocument();
    const field = screen.getByLabelText(enPreview.password.label);
    const submit = screen.getByRole("button", { name: enPreview.password.submit });
    expect(field).toHaveFocus();
    expect(submit).toBeDisabled();

    await userEvent.type(field, `${SECRET}{Enter}`);
    expect(submit).toBeEnabled();
    expect(onSubmitPassword).toHaveBeenCalledWith(SECRET);
  });
});
