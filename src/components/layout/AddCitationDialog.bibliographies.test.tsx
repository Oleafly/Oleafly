// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCitation: vi.fn(),
  bibtexForHit: vi.fn(),
  addCitation: vi.fn(),
  choices: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/features/citation", () => ({
  resolveCitation: mocks.resolveCitation,
  bibtexForHit: mocks.bibtexForHit,
  addCitation: mocks.addCitation,
}));
vi.mock("@/features/citation-bibliographies", () => ({
  citationBibliographyChoices: mocks.choices,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { rememberBibliography, rememberedBibliography } from "@/lib/citation/bibliography-choices";
import { useCitationStore } from "@/store/citation";
import { useFilesStore } from "@/store/files";
import { AddCitationDialog } from "./AddCitationDialog";

const copy = enShell.addCitation;

async function reachPreview() {
  mocks.resolveCitation.mockResolvedValue({ bibtex: "@article{a}" });
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(copy.placeholder), "10.1/x{Enter}");
  await screen.findByText(copy.entry);
  return user;
}

function pickBibliography(name: string) {
  const trigger = screen.getByRole("combobox", { name: copy.bibliography });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(screen.getByRole("option", { name }));
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.addCitation.mockResolvedValue({ key: "a" });
  useFilesStore.setState({ projectId: "thesis" });
  useCitationStore.setState({ open: true });
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => localStorage.clear());

describe("AddCitationDialog with several bibliographies", () => {
  it("asks which bibliography gets the entry and remembers the answer", async () => {
    mocks.choices.mockResolvedValue(["primary.bib", "secondary.bib"]);
    render(<AddCitationDialog />);
    const user = await reachPreview();
    const trigger = await screen.findByRole("combobox", { name: copy.bibliography });
    expect(trigger).toHaveTextContent("primary.bib");

    pickBibliography("secondary.bib");
    await user.click(screen.getByRole("button", { name: copy.confirm }));

    await waitFor(() => expect(mocks.addCitation).toHaveBeenCalledWith("@article{a}", { bibliography: "secondary.bib" }));
    expect(rememberedBibliography("thesis")).toBe("secondary.bib");
  });

  it("starts from the bibliography used last time in this project", async () => {
    rememberBibliography("thesis", "secondary.bib");
    mocks.choices.mockResolvedValue(["primary.bib", "secondary.bib"]);
    render(<AddCitationDialog />);
    await reachPreview();
    expect(await screen.findByRole("combobox", { name: copy.bibliography })).toHaveTextContent("secondary.bib");
  });

  it("does not ask when the project has one bibliography", async () => {
    mocks.choices.mockResolvedValue(["refs.bib"]);
    render(<AddCitationDialog />);
    const user = await reachPreview();
    expect(screen.queryByRole("combobox", { name: copy.bibliography })).toBeNull();
    await user.click(screen.getByRole("button", { name: copy.confirm }));
    await waitFor(() => expect(mocks.addCitation).toHaveBeenCalledWith("@article{a}"));
  });
});
