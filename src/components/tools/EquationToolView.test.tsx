// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeViewStore } from "@/store/home-view";

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("./EquationPreviewPanel", () => ({
  EQUATION_EXAMPLES: [{ latex: "x" }],
  EquationPreviewPanel: () => <div />,
  renderEquation: () => ({ html: "<math />", error: null }),
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ trigger, children }: { trigger: ReactNode; children: ReactNode }) => <div>{trigger}{children}</div>,
  PopoverItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
}));
vi.mock("@/components/layout/ThemeControls", () => ({ ThemeMenu: () => <div /> }));
vi.mock("@/components/layout/WindowControls", () => ({ WindowControls: () => <div /> }));
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock("@/features/equation-export", () => ({
  equationToSvgDocument: vi.fn(),
  svgDocumentToPngBytes: vi.fn(),
}));

import { EquationToolView } from "./EquationToolView";

beforeEach(() => {
  vi.clearAllMocks();
  useHomeViewStore.setState({ page: "equation" });
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("clipboard denied"));
});

describe("EquationToolView", () => {
  it("reports a clipboard failure when MathML cannot be copied", async () => {
    render(<EquationToolView />);
    fireEvent.click(screen.getByRole("button", { name: /Copy MathML for Word/i }));
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("clipboard denied"));
  });

  it("reports a clipboard failure when LaTeX cannot be copied", async () => {
    render(<EquationToolView />);
    fireEvent.click(screen.getByRole("button", { name: /Copy LaTeX/i }));
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("clipboard denied"));
  });
});
