// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { oleaflyBibtex } from "@/lib/cite-oleafly";
import { CiteOleaflyCard } from "./CiteOleaflyCard";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

describe("CiteOleaflyCard", () => {
  it("shows the entry for the running version and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CiteOleaflyCard version="0.4.0" />);

    expect(screen.getByTestId("cite-oleafly-bibtex").textContent).toBe(oleaflyBibtex("0.4.0"));
    fireEvent.click(screen.getByRole("button", { name: "Copy BibTeX" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(oleaflyBibtex("0.4.0")));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
