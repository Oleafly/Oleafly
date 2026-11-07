// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { ArtifactPanel } from "./ArtifactPanel";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { ArtifactItem } from "./types";

const copy = enNotes.artifacts;
const NOW = Date.now();

function artifact(overrides: Partial<ArtifactItem> & Pick<ArtifactItem, "id" | "title" | "kind">): ArtifactItem {
  return {
    project: "Vision",
    noteIds: ["n1"],
    updatedAt: NOW - 3_600_000,
    author: "agent",
    agent: "Codex",
    chat: "Ablation chat",
    summary: `${overrides.title} summary`,
    ...overrides,
  };
}

const lossCurve = artifact({
  id: "a1",
  title: "Loss curve",
  kind: "figure",
  preview: { type: "image", src: "asset://loss.png" },
  snippet: "![Loss curve](loss.png)",
});
const metrics = artifact({
  id: "a2",
  title: "Run 42",
  kind: "run",
  preview: {
    type: "metrics",
    metrics: [
      { label: "Accuracy", value: "91.2%" },
      { label: "Loss", value: "0.31" },
    ],
  },
});
const report = artifact({
  id: "a3",
  title: "Ablation report",
  kind: "report",
  author: "you",
  agent: undefined,
  preview: { type: "text", heading: "Findings", body: "Masking helps at 75%." },
});
const attention = artifact({ id: "a4", title: "Attention map", kind: "html" });
const bare = artifact({ id: "a5", title: "Raw dump", kind: "report" });
const elsewhere = artifact({ id: "a6", title: "Other note's figure", kind: "figure", noteIds: ["n2"] });

function fakeData(artifacts: readonly ArtifactItem[]): NotesData {
  return {
    notes: [],
    artifacts,
    experiments: [],
    agents: [],
    citations: [],
    papers: [],
    proposeEdits: vi.fn(),
    loadNote: vi.fn(),
    saveNote: vi.fn(),
  };
}

function renderPanel(selectedId: string | null, artifacts: readonly ArtifactItem[] = [lossCurve, metrics, report, attention, bare, elsewhere]) {
  const handlers = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onInsert: vi.fn(),
    onNewProject: vi.fn(),
  };
  render(
    <NotesDataProvider value={fakeData(artifacts)}>
      <ArtifactPanel noteId="n1" selectedId={selectedId} {...handlers} />
    </NotesDataProvider>,
  );
  return handlers;
}

function details(): HTMLElement {
  const section = document.querySelector("aside section");
  if (!(section instanceof HTMLElement)) throw new Error("no artifact details");
  return section;
}

beforeAll(async () => {
  await loadNamespace("notes");
});

describe("ArtifactPanel", () => {
  it("says there is nothing yet when the note has no artifacts", () => {
    renderPanel(null, [elsewhere]);
    expect(screen.getByRole("complementary", { name: copy.title })).toBeInTheDocument();
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists only this note's artifacts and selects the first by default", () => {
    renderPanel(null);
    const items = within(screen.getByRole("list")).getAllByRole("button");
    expect(items.map((item) => item.textContent)).toEqual([
      "Loss curve",
      "Run 42",
      "Ablation report",
      "Attention map",
      "Raw dump",
    ]);
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[1]).not.toHaveAttribute("aria-current");
  });

  it("falls back to the first artifact when the selected one is not in the list", () => {
    renderPanel("a6");
    expect(within(details()).getByRole("heading", { name: "Loss curve" })).toBeInTheDocument();
  });

  it("selects an artifact when it is clicked", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel(null);
    await user.click(screen.getByRole("button", { name: "Run 42" }));
    expect(handlers.onSelect).toHaveBeenCalledWith("a2");
  });

  it("describes the selected artifact with its kind, agent, age and chat", () => {
    renderPanel("a1");
    const panel = details();
    expect(within(panel).getByRole("heading", { name: "Loss curve" })).toBeInTheDocument();
    const age = formatRelativeTimeFrom(lossCurve.updatedAt, Date.now(), { dateAfterDays: 7 });
    expect(panel).toHaveTextContent(`${copy.kind.figure} · Codex · ${age}`);
    expect(panel).toHaveTextContent("From chat: Ablation chat");
    expect(panel).toHaveTextContent("Loss curve summary");
  });

  it("previews an image artifact", () => {
    renderPanel("a1");
    expect(within(details()).getByRole("img", { name: "Loss curve" })).toHaveAttribute("src", "asset://loss.png");
  });

  it("previews run metrics as a grid", () => {
    renderPanel("a2");
    const grid = details().querySelector("dl") as HTMLElement;
    expect(within(grid).getByText("Accuracy")).toBeInTheDocument();
    expect(within(grid).getByText("91.2%")).toBeInTheDocument();
    expect(within(grid).getByText("Loss")).toBeInTheDocument();
    expect(within(grid).getByText("0.31")).toBeInTheDocument();
  });

  it("previews a text artifact and credits you when no agent made it", () => {
    renderPanel("a3");
    const panel = details();
    expect(panel).toHaveTextContent("Findings");
    expect(panel).toHaveTextContent("Masking helps at 75%.");
    expect(panel).toHaveTextContent(`${copy.kind.report} · ${enNotes.library.author.you} · `);
  });

  it("credits an unnamed agent as an agent, not as you", () => {
    renderPanel("a1", [{ ...lossCurve, agent: undefined }]);
    expect(details()).toHaveTextContent(`${copy.kind.figure} · ${enNotes.library.agentFallback} · `);
  });

  it("explains that interactive figures cannot be previewed", () => {
    renderPanel("a4");
    expect(within(details()).getByText(copy.htmlPreview)).toBeInTheDocument();
  });

  it("shows no preview when the artifact has none", () => {
    renderPanel("a5");
    const panel = details();
    expect(panel.querySelector("img, dl")).toBeNull();
    expect(panel).not.toHaveTextContent(copy.htmlPreview);
  });

  it("offers Insert in note only for artifacts with a snippet", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel("a1");
    await user.click(screen.getByRole("button", { name: copy.insert }));
    expect(handlers.onInsert).toHaveBeenCalledWith(lossCurve);
  });

  it("hides Insert in note when the artifact has no snippet", () => {
    renderPanel("a2");
    expect(screen.queryByRole("button", { name: copy.insert })).not.toBeInTheDocument();
  });

  it("starts a new project from the selected artifact", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel("a2");
    await user.click(within(details()).getByRole("button", { name: copy.newProject }));
    expect(handlers.onNewProject).toHaveBeenCalledWith(metrics);
  });

  it("closes from the close button", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel(null);
    await user.click(screen.getByRole("button", { name: copy.close }));
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });
});
