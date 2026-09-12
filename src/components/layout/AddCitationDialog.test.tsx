// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCitation: vi.fn(),
  bibtexForHit: vi.fn(),
  addCitation: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/features/citation", () => ({
  resolveCitation: mocks.resolveCitation,
  bibtexForHit: mocks.bibtexForHit,
  addCitation: mocks.addCitation,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: vi.fn(), info: vi.fn() },
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { useCitationStore } from "@/store/citation";
import { AddCitationDialog } from "./AddCitationDialog";

const copy = enShell.addCitation;

const HIT = {
  title: "Attention is all you need",
  authors: ["Vaswani", "Shazeer", "Parmar", "Uszkoreit"],
  year: "2017",
  venue: "NeurIPS",
};

beforeEach(() => {
  mocks.resolveCitation.mockReset();
  mocks.bibtexForHit.mockReset();
  mocks.addCitation.mockReset();
  mocks.success.mockClear();
  useCitationStore.setState({ open: true });
});

describe("AddCitationDialog", () => {
  it("renders nothing while it is closed", () => {
    useCitationStore.setState({ open: false });
    const { container } = render(<AddCitationDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the example lookups before anything is typed", () => {
    render(<AddCitationDialog />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.getByText(copy.hint)).toBeInTheDocument();
    expect(screen.getByText(copy.privacyNote)).toBeInTheDocument();
    for (const label of [
      copy.examples.doi,
      copy.examples.arxiv,
      copy.examples.title,
    ]) {
      expect(screen.getByText(`${label}:`)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: copy.lookUp })).toBeDisabled();
  });

  it("looks an example up when the reader picks it", async () => {
    mocks.resolveCitation.mockResolvedValue({ bibtex: "@article{a}" });
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    await user.click(screen.getByText(`${copy.examples.arxiv}:`));
    expect(mocks.resolveCitation).toHaveBeenCalledWith("1706.03762");
    expect(await screen.findByText(copy.entry)).toBeInTheDocument();
    expect(screen.getByText("@article{a}")).toBeInTheDocument();
  });

  it("reports a lookup error", async () => {
    mocks.resolveCitation.mockResolvedValue({ error: "Network unreachable" });
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "10.1/x{Enter}");
    expect(await screen.findByText("Network unreachable")).toBeInTheDocument();
  });

  it("reports an empty result set", async () => {
    mocks.resolveCitation.mockResolvedValue({ hits: [] });
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "nothing");
    await user.click(screen.getByRole("button", { name: copy.lookUp }));
    expect(await screen.findByText(copy.noResults)).toBeInTheDocument();
  });

  it("lists the matches and previews the one the reader picks", async () => {
    mocks.resolveCitation.mockResolvedValue({ hits: [HIT] });
    mocks.bibtexForHit.mockResolvedValue("@inproceedings{vaswani2017}");
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "attention");
    await user.click(screen.getByRole("button", { name: copy.lookUp }));
    expect(
      await screen.findByText(copy.matches_one.replace("{{count}}", "1")),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Attention is all you need/ }));
    expect(await screen.findByText("@inproceedings{vaswani2017}")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: enCommon.actions.cancel }),
    ).toBeInTheDocument();
  });

  it("adds the previewed entry and closes", async () => {
    mocks.resolveCitation.mockResolvedValue({ bibtex: "@article{a}" });
    mocks.addCitation.mockResolvedValue({ key: "a" });
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "10.1/x{Enter}");
    await user.click(await screen.findByRole("button", { name: copy.confirm }));
    await waitFor(() => expect(useCitationStore.getState().open).toBe(false));
    expect(mocks.success).toHaveBeenCalledWith(
      copy.added.replace("{{cite}}", "\\cite{a}"),
    );
  });

  it("keeps the preview open when the entry cannot be added", async () => {
    mocks.resolveCitation.mockResolvedValue({ bibtex: "@article{a}" });
    mocks.addCitation.mockResolvedValue({ error: "No bibliography file" });
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "10.1/x{Enter}");
    await user.click(await screen.findByRole("button", { name: copy.confirm }));
    expect(await screen.findByText("No bibliography file")).toBeInTheDocument();
    expect(useCitationStore.getState().open).toBe(true);
  });

  it("closes on escape in the search field", async () => {
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    const field = screen.getByPlaceholderText(copy.placeholder);
    await user.type(field, "10.1/x");
    await user.type(field, "{Escape}");
    await waitFor(() => expect(useCitationStore.getState().open).toBe(false));
  });

  it("closes from the cancel button of the preview", async () => {
    mocks.resolveCitation.mockResolvedValue({ bibtex: "@article{a}" });
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "10.1/x{Enter}");
    await user.click(await screen.findByRole("button", { name: enCommon.actions.cancel }));
    await waitFor(() => expect(useCitationStore.getState().open).toBe(false));
  });

  it("closes when the backdrop is used", async () => {
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.close }));
    await waitFor(() => expect(useCitationStore.getState().open).toBe(false));
  });
});
