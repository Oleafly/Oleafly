// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { MoleculeView } from "./molecule-block";

vi.mock("3dmol", () => {
  throw new Error("The viewer chunk failed to load.");
});

beforeAll(async () => {
  await loadNamespace("notes");
});

describe("MoleculeView without its library", () => {
  it("says the viewer couldn't load", async () => {
    const view = render(<MoleculeView data="1\n\nH 0 0 0" format="xyz" style={null} color={null} mode="shared" />);
    expect(await screen.findByText(enNotes.blocks.molecule.loadError)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    view.unmount();
  });

  it("stays quiet when unmounted before the load fails", async () => {
    const view = render(<MoleculeView data="1\n\nH 0 0 0" format="xyz" style={null} color={null} mode="shared" />);
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(enNotes.blocks.molecule.loadError)).toBeNull();
  });
});
