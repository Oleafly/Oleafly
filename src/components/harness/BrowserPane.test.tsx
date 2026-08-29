// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrowserPane } from "./BrowserPane";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

// jsdom is not Tauri, so the pane exercises the iframe fallback path here;
// the native path needs the desktop shell (covered by packaged e2e).
describe("BrowserPane", () => {
  it("shows the placeholder until an address is opened", () => {
    render(<BrowserPane />);
    expect(screen.getByLabelText("Browser address")).toBeInTheDocument();
    expect(screen.queryByTitle("Composer browser")).not.toBeInTheDocument();
  });

  it("normalizes and opens plain addresses as https", () => {
    render(<BrowserPane />);
    const input = screen.getByLabelText("Browser address");
    fireEvent.change(input, { target: { value: "arxiv.org/abs/2401.00001" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const frame = screen.getByTitle("Composer browser") as HTMLIFrameElement;
    expect(frame.src).toBe("https://arxiv.org/abs/2401.00001");
  });

  it("rejects non-http schemes", () => {
    render(<BrowserPane />);
    const input = screen.getByLabelText("Browser address");
    fireEvent.change(input, { target: { value: "file:///etc/passwd" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.queryByTitle("Composer browser")).not.toBeInTheDocument();
  });
});
