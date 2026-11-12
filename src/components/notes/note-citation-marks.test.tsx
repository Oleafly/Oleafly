// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { type CitationLibrary, NoteReferences } from "./note-citation-marks";
import { NotePanelSections } from "./NoteListItem";
import "./tests/setup";

const REFERENCES = enNotes.citations.references;

const LIBRARY: CitationLibrary = {
  entries: new Map([
    ["he2022", { key: "he2022", label: "He 2022", fields: { author: "He, Kaiming", year: "2022", title: "Masked Autoencoders" } }],
    ["chen2020", { key: "chen2020", label: "Chen 2020", fields: { author: "Chen, Ting", year: "2020", title: "SimCLR" } }],
  ]),
  notes: new Map(),
};

function header(count: number): HTMLElement {
  return screen.getByRole("button", { name: `${REFERENCES} ${count}` });
}

afterEach(() => {
  useNotesPrefsStore.getState().set("referencesOpen", true);
});

describe("NoteReferences folding", () => {
  it("counts the known references in the header and folds and opens the list from it", () => {
    render(<NoteReferences library={LIBRARY} cited={["he2022", "ghost", "chen2020"]} />);
    const section = screen.getByRole("region", { name: REFERENCES });
    const toggle = header(2);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(list?.tagName).toBe("UL");
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(list).not.toBeVisible();
    expect(within(section).queryAllByRole("listitem")).toHaveLength(0);
    expect(useNotesPrefsStore.getState().referencesOpen).toBe(false);
    fireEvent.click(toggle);
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
  });

  it("remembers the folded choice for the next note it shows", () => {
    const first = render(<NoteReferences library={LIBRARY} cited={["he2022"]} />);
    fireEvent.click(header(1));
    first.unmount();
    render(<NoteReferences library={LIBRARY} cited={["chen2020", "he2022"]} />);
    expect(header(2)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(header(2));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("stays in the info panel with a zero count and a short line when nothing is cited", () => {
    const { unmount } = render(<NoteReferences library={LIBRARY} cited={["ghost"]} />);
    expect(screen.queryByRole("region", { name: REFERENCES })).not.toBeInTheDocument();
    unmount();
    const { rerender } = render(
      <NotePanelSections>
        <NoteReferences library={LIBRARY} cited={[]} />
      </NotePanelSections>,
    );
    expect(header(0)).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("region", { name: REFERENCES })).getByText(enNotes.info.noReferences)).toBeInTheDocument();
    rerender(
      <NotePanelSections>
        <NoteReferences library={LIBRARY} cited={["ghost"]} />
      </NotePanelSections>,
    );
    expect(header(0)).toBeInTheDocument();
    expect(screen.queryByText(enNotes.info.noReferences)).not.toBeInTheDocument();
  });
});
