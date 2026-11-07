// @vitest-environment jsdom

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { ArtifactPanel } from "./ArtifactPanel";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { ArtifactItem, ArtifactPreview, NoteItem } from "./types";

const copy = enNotes.artifacts;
const NOW = Date.now();

const related: NoteItem = {
  id: "n1",
  title: "Masking ablation",
  project: "Vision",
  relatedProjectId: "p1",
  updatedAt: NOW,
  author: "you",
  summary: "",
};

const loose: NoteItem = {
  id: "n2",
  title: "Loose ideas",
  project: "Notes",
  updatedAt: NOW,
  author: "you",
  summary: "",
};

function artifact(overrides: Partial<ArtifactItem> & Pick<ArtifactItem, "id" | "title" | "kind">): ArtifactItem {
  return {
    taskId: "t1",
    path: `outputs/${overrides.id}.bin`,
    projectId: "p1",
    project: "Vision",
    updatedAt: NOW - 3_600_000,
    agent: "Codex",
    chat: "Masking sweep",
    summary: `${overrides.title} summary`,
    ...overrides,
  };
}

const lossCurve = artifact({ id: "a1", title: "Loss curve", kind: "figure", path: "outputs/loss curve.png" });
const metrics = artifact({ id: "a2", title: "Metrics", kind: "data", path: "outputs/metrics.csv" });
const findings = artifact({ id: "a3", title: "Findings", kind: "report", path: "outputs/findings.md", agent: undefined, summary: "" });
const attention = artifact({ id: "a4", title: "Attention map", kind: "html", path: "outputs/attention.html" });
const elsewhere = artifact({ id: "a5", title: "Other project's figure", kind: "figure", projectId: "p2" });
const ALL = [lossCurve, metrics, findings, attention, elsewhere];

const IMAGE_SRC = "data:image/png;base64,AAAA";
const IMAGE: ArtifactPreview = { type: "image", src: IMAGE_SRC };
const FINDING = "Masking helps at 75%.";

type Previewer = (artifact: ArtifactItem) => Promise<ArtifactPreview>;
type Inserter = (artifact: ArtifactItem) => Promise<void>;

function table(truncated: boolean): ArtifactPreview {
  return {
    type: "table",
    rows: [
      ["step", "loss"],
      ["1", "0.92"],
      ["2", "0.41"],
    ],
    truncated,
  };
}

function text(truncated: boolean): ArtifactPreview {
  return { type: "text", text: FINDING, truncated };
}

const TABLE = table(false);
const TEXT = text(false);

function previewing(preview: ArtifactPreview) {
  return vi.fn<Previewer>(async () => preview);
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type PanelProps = ComponentProps<typeof ArtifactPanel>;

interface Setup {
  note?: NoteItem;
  selectedId?: string | null;
  artifacts?: readonly ArtifactItem[];
  previewArtifact?: NotesData["previewArtifact"] | null;
  handlers?: Partial<Pick<PanelProps, "onInsert" | "onNewProject">>;
}

function renderPanel({ note = related, selectedId = null, artifacts = ALL, previewArtifact = previewing(IMAGE), handlers = {} }: Setup = {}) {
  const props = {
    note,
    onSelect: vi.fn(),
    onInsert: vi.fn<Inserter>(async () => {}),
    onNewProject: vi.fn(),
    ...handlers,
  };
  const data: NotesData = {
    notes: [note],
    artifacts,
    experiments: [],
    agents: [],
    citations: [],
    papers: [],
    ...(previewArtifact ? { previewArtifact } : {}),
    proposeEdits: vi.fn(),
    loadNote: vi.fn(),
    saveNote: vi.fn(),
  };
  const element = (id: string | null) => (
    <NotesDataProvider value={data}>
      <ArtifactPanel {...props} selectedId={id} />
    </NotesDataProvider>
  );
  const view = render(element(selectedId));
  return { ...props, select: (id: string | null) => view.rerender(element(id)) };
}

function details(): HTMLElement {
  const section = document.querySelector("aside section");
  if (!(section instanceof HTMLElement)) throw new Error("no artifact details");
  return section;
}

function insertButton(): HTMLElement {
  return within(details()).getByRole("button", { name: /^(Insert in note|Copying)$/u });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

describe("ArtifactPanel", () => {
  describe("empty states", () => {
    it("says research tasks in the related project will fill it", () => {
      renderPanel({ artifacts: [elsewhere] });
      expect(screen.getByRole("complementary", { name: copy.title })).toBeInTheDocument();
      expect(screen.getByRole("complementary", { name: copy.title })).toBeInTheDocument();
      expect(screen.getByText(copy.empty.replace("{{project}}", "Vision"))).toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(document.querySelector("aside section")).toBeNull();
    });

    it("asks for a project when the note has none, even if artifacts exist", () => {
      renderPanel({ note: loose });
      expect(screen.getByText(copy.noProject)).toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });
  });

  describe("list", () => {
    it("lists only the related project's artifacts and selects the first by default", async () => {
      renderPanel();
      const items = within(screen.getByRole("list")).getAllByRole("button");
      expect(items.map((item) => item.textContent)).toEqual(["Loss curve", "Metrics", "Findings", "Attention map"]);
      expect(items[0]).toHaveAttribute("aria-current", "true");
      for (const item of items.slice(1)) expect(item).not.toHaveAttribute("aria-current");
      await screen.findByRole("img", { name: "Loss curve" });
    });

    it("marks the selected artifact as current", async () => {
      renderPanel({ selectedId: "a2", previewArtifact: previewing(TABLE) });
      expect(screen.getByRole("button", { name: "Metrics" })).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("button", { name: "Loss curve" })).not.toHaveAttribute("aria-current");
      expect(within(details()).getByRole("heading", { name: "Metrics" })).toBeInTheDocument();
      await screen.findByRole("table");
    });

    it("falls back to the first artifact when the selected one belongs elsewhere", async () => {
      renderPanel({ selectedId: "a5" });
      expect(within(details()).getByRole("heading", { name: "Loss curve" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Loss curve" })).toHaveAttribute("aria-current", "true");
      await screen.findByRole("img", { name: "Loss curve" });
    });

    it("selects an artifact when it is clicked", async () => {
      const user = userEvent.setup();
      const { onSelect } = renderPanel({ previewArtifact: null });
      await user.click(screen.getByRole("button", { name: "Metrics" }));
      expect(onSelect).toHaveBeenCalledWith("a2");
    });
  });

  describe("provenance", () => {
    it("shows the kind, agent, age, task, path and summary", async () => {
      renderPanel({ selectedId: "a1" });
      const panel = details();
      expect(within(panel).getByRole("heading", { name: "Loss curve" })).toBeInTheDocument();
      const age = formatRelativeTimeFrom(lossCurve.updatedAt, Date.now(), { dateAfterDays: 7 });
      expect(panel).toHaveTextContent(`${copy.kind.figure} Codex · ${age}`);
      expect(within(panel).getByText(copy.kind.figure).closest("[data-kind]")).toHaveAttribute("data-kind", "figure");
      expect(within(panel).getByText("Codex").closest("[data-agent-tag]")).toBeInTheDocument();
      expect(within(panel).getByText(copy.fromTask.replace("{{task}}", "Masking sweep"))).toBeInTheDocument();
      expect(within(panel).getByText("outputs/loss curve.png")).not.toHaveAttribute("title");
      expect(within(panel).getByText("Loss curve summary")).toBeInTheDocument();
      await screen.findByRole("img", { name: "Loss curve" });
    });

    it("shows the full path in a tooltip on hover", async () => {
      const user = userEvent.setup();
      renderPanel({ selectedId: "a1", previewArtifact: null });
      await user.hover(within(details()).getByText("outputs/loss curve.png"));
      expect(await screen.findByRole("tooltip")).toHaveTextContent("outputs/loss curve.png");
    });

    it("tints each artifact in the list with its kind", () => {
      renderPanel({ previewArtifact: null });
      const kinds = within(screen.getByRole("list"))
        .getAllByRole("button")
        .map((item) => item.querySelector("[data-kind]")?.getAttribute("data-kind"));
      expect(kinds).toEqual(["figure", "data", "report", "html"]);
      expect(screen.getByRole("button", { name: "Metrics" }).querySelector("[data-kind]")).toHaveClass("bg-emerald-500/10");
      expect(screen.getByRole("button", { name: "Loss curve" })).toHaveClass("bg-primary/10");
      expect(screen.getByRole("button", { name: "Metrics" })).not.toHaveClass("bg-primary/10");
    });

    it("falls back to a generic agent label and drops an empty summary", async () => {
      renderPanel({ selectedId: "a3", previewArtifact: previewing(TEXT) });
      const panel = details();
      expect(panel).toHaveTextContent(`${copy.kind.report} ${enNotes.library.agentFallback} · `);
      await within(panel).findByText(FINDING);
      for (const paragraph of panel.querySelectorAll("p")) expect(paragraph.textContent).not.toBe("");
    });

    it("labels data and interactive artifacts by kind", async () => {
      renderPanel({ selectedId: "a4", previewArtifact: previewing({ type: "none", reason: "html" }) });
      expect(details()).toHaveTextContent(`${copy.kind.html} Codex · `);
      await screen.findByText(copy.htmlPreview);
    });
  });

  describe("preview", () => {
    it("asks for a preview of the selected artifact and shows an image", async () => {
      const previewArtifact = previewing(IMAGE);
      renderPanel({ selectedId: "a1", previewArtifact });
      expect(await within(details()).findByRole("img", { name: "Loss curve" })).toHaveAttribute("src", IMAGE_SRC);
      expect(previewArtifact).toHaveBeenCalledWith(lossCurve);
      expect(screen.queryByText(copy.loading)).not.toBeInTheDocument();
    });

    it("shows a table with its header row", async () => {
      renderPanel({ selectedId: "a2", previewArtifact: previewing(TABLE) });
      const table = await within(details()).findByRole("table");
      expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["step", "loss"]);
      expect(within(table).getAllByRole("row")).toHaveLength(3);
      expect(within(table).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["1", "0.92", "2", "0.41"]);
      expect(screen.queryByText(copy.truncated)).not.toBeInTheDocument();
    });

    it("says when a table shows only the start of the file", async () => {
      renderPanel({ selectedId: "a2", previewArtifact: previewing(table(true)) });
      await within(details()).findByRole("table");
      expect(screen.getByText(copy.truncated)).toBeInTheDocument();
    });

    it("shows text", async () => {
      renderPanel({ selectedId: "a3", previewArtifact: previewing(TEXT) });
      const text = await within(details()).findByText(FINDING);
      expect(text.tagName).toBe("PRE");
      expect(within(details()).getByRole("button", { name: "Copy" })).toBeInTheDocument();
      expect(screen.queryByText(copy.truncated)).not.toBeInTheDocument();
    });

    it("says when text shows only the start of the file", async () => {
      renderPanel({ selectedId: "a3", previewArtifact: previewing(text(true)) });
      await within(details()).findByText(FINDING);
      expect(screen.getByText(copy.truncated)).toBeInTheDocument();
    });

    it.each([
      ["html", copy.htmlPreview],
      ["missing", copy.missing],
      ["binary", copy.binary],
    ] as const)("explains why a %s file has no preview", async (reason, message) => {
      renderPanel({ selectedId: "a4", previewArtifact: previewing({ type: "none", reason }) });
      expect(await within(details()).findByText(message)).toBeInTheDocument();
      expect(details().querySelector("img, table, pre")).toBeNull();
    });

    it("shows a loading line until the preview arrives", async () => {
      const pending = deferred<ArtifactPreview>();
      renderPanel({ selectedId: "a3", previewArtifact: vi.fn<Previewer>(() => pending.promise) });
      expect(within(details()).getByText(copy.loading)).toBeInTheDocument();
      await act(async () => pending.resolve(TEXT));
      expect(screen.queryByText(copy.loading)).not.toBeInTheDocument();
      expect(within(details()).getByText(FINDING)).toBeInTheDocument();
    });

    it("says why a preview failed", async () => {
      renderPanel({ selectedId: "a1", previewArtifact: vi.fn<Previewer>(async () => Promise.reject(new Error("disk gone"))) });
      expect(await within(details()).findByText(copy.previewFailed.replace("{{error}}", "disk gone"))).toBeInTheDocument();
      expect(screen.queryByText(copy.loading)).not.toBeInTheDocument();
    });

    it("shows no preview area when previews are not available", () => {
      renderPanel({ selectedId: "a1", previewArtifact: null });
      const panel = details();
      expect(within(panel).getByRole("heading", { name: "Loss curve" })).toBeInTheDocument();
      expect(within(panel).queryByText(copy.loading)).not.toBeInTheDocument();
      expect(panel.querySelector("img, table, pre")).toBeNull();
      expect(within(panel).getByText("Loss curve summary")).toBeInTheDocument();
    });

    it("ignores a preview that arrives after another artifact was selected", async () => {
      const first = deferred<ArtifactPreview>();
      const second = deferred<ArtifactPreview>();
      const previewArtifact = vi.fn<Previewer>((item) => (item.id === "a1" ? first.promise : second.promise));
      const panel = renderPanel({ selectedId: "a1", previewArtifact });
      panel.select("a3");
      expect(within(details()).getByText(copy.loading)).toBeInTheDocument();
      await act(async () => first.resolve(IMAGE));
      expect(screen.queryByRole("img", { name: "Loss curve" })).not.toBeInTheDocument();
      expect(within(details()).getByText(copy.loading)).toBeInTheDocument();
      await act(async () => second.resolve(TEXT));
      expect(within(details()).getByText(FINDING)).toBeInTheDocument();
      expect(previewArtifact.mock.calls.map(([item]) => item.id)).toEqual(["a1", "a3"]);
    });

    it("ignores a failure that arrives after another artifact was selected", async () => {
      const first = deferred<ArtifactPreview>();
      const second = deferred<ArtifactPreview>();
      const previewArtifact = vi.fn<Previewer>((item) => (item.id === "a1" ? first.promise : second.promise));
      const panel = renderPanel({ selectedId: "a1", previewArtifact });
      panel.select("a3");
      await act(async () => first.reject(new Error("disk gone")));
      expect(screen.queryByText(copy.previewFailed.replace("{{error}}", "disk gone"))).not.toBeInTheDocument();
      expect(within(details()).getByText(copy.loading)).toBeInTheDocument();
      await act(async () => second.resolve(TEXT));
      expect(within(details()).getByText(FINDING)).toBeInTheDocument();
    });
  });

  describe("insert", () => {
    it("inserts the selected artifact and shows Copying while it works", async () => {
      const user = userEvent.setup();
      const pending = deferred<void>();
      const onInsert = vi.fn<Inserter>(() => pending.promise);
      renderPanel({ selectedId: "a1", previewArtifact: null, handlers: { onInsert } });
      expect(insertButton()).toHaveTextContent(copy.insert);
      await user.click(insertButton());
      expect(onInsert).toHaveBeenCalledWith(lossCurve);
      expect(insertButton()).toHaveTextContent(copy.inserting);
      expect(insertButton()).toBeDisabled();
      await act(async () => pending.resolve());
      expect(insertButton()).toHaveTextContent(copy.insert);
      expect(insertButton()).toBeEnabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("says why an insert failed and lets you try again", async () => {
      const user = userEvent.setup();
      const onInsert = vi.fn<Inserter>(async () => {}).mockRejectedValueOnce(new Error("no space left"));
      renderPanel({ selectedId: "a1", previewArtifact: null, handlers: { onInsert } });
      await user.click(insertButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(copy.insertFailed.replace("{{error}}", "no space left"));
      expect(insertButton()).toHaveTextContent(copy.insert);
      expect(insertButton()).toBeEnabled();
      await user.click(insertButton());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onInsert).toHaveBeenCalledTimes(2);
    });

    it("reports a failure that is not an Error by its text", async () => {
      const user = userEvent.setup();
      const onInsert = vi.fn<Inserter>(async () => Promise.reject("read-only folder"));
      renderPanel({ selectedId: "a1", previewArtifact: null, handlers: { onInsert } });
      await user.click(insertButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(copy.insertFailed.replace("{{error}}", "read-only folder"));
    });

    it("keeps an insert error with its own artifact", async () => {
      const user = userEvent.setup();
      const onInsert = vi.fn<Inserter>(async () => Promise.reject(new Error("no space left")));
      const panel = renderPanel({ selectedId: "a1", previewArtifact: null, handlers: { onInsert } });
      await user.click(insertButton());
      await screen.findByRole("alert");
      panel.select("a2");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(insertButton()).toHaveTextContent(copy.insert);
      panel.select("a1");
      expect(screen.getByRole("alert")).toHaveTextContent("no space left");
    });

    it("does not show one artifact's insert as busy on another", async () => {
      const user = userEvent.setup();
      const pending = deferred<void>();
      const onInsert = vi.fn<Inserter>(() => pending.promise);
      const panel = renderPanel({ selectedId: "a1", previewArtifact: null, handlers: { onInsert } });
      await user.click(insertButton());
      expect(insertButton()).toBeDisabled();
      panel.select("a2");
      expect(insertButton()).toHaveTextContent(copy.insert);
      expect(insertButton()).toBeEnabled();
      await act(async () => pending.resolve());
      panel.select("a1");
      expect(insertButton()).toHaveTextContent(copy.insert);
      expect(insertButton()).toBeEnabled();
    });

    it("lets an older insert finish without touching a newer one", async () => {
      const user = userEvent.setup();
      const older = deferred<void>();
      const newer = deferred<void>();
      const onInsert = vi.fn<Inserter>((item) => (item.id === "a1" ? older.promise : newer.promise));
      const panel = renderPanel({ selectedId: "a1", previewArtifact: null, handlers: { onInsert } });
      await user.click(insertButton());
      panel.select("a2");
      await user.click(insertButton());
      expect(insertButton()).toHaveTextContent(copy.inserting);
      await act(async () => older.resolve());
      expect(insertButton()).toHaveTextContent(copy.inserting);
      await act(async () => newer.reject(new Error("locked")));
      expect(screen.getByRole("alert")).toHaveTextContent("locked");
      expect(insertButton()).toBeEnabled();
    });

    it("drops an older insert's failure once a newer insert has started", async () => {
      const user = userEvent.setup();
      const older = deferred<void>();
      const newer = deferred<void>();
      const onInsert = vi.fn<Inserter>((item) => (item.id === "a1" ? older.promise : newer.promise));
      const panel = renderPanel({ selectedId: "a1", previewArtifact: null, handlers: { onInsert } });
      await user.click(insertButton());
      panel.select("a2");
      await user.click(insertButton());
      await act(async () => older.reject(new Error("stale")));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(insertButton()).toHaveTextContent(copy.inserting);
      await act(async () => newer.resolve());
      expect(insertButton()).toHaveTextContent(copy.insert);
      panel.select("a1");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("actions", () => {
    it("starts a new project from the selected artifact", async () => {
      const user = userEvent.setup();
      const { onNewProject } = renderPanel({ selectedId: "a2", previewArtifact: null });
      await user.click(within(details()).getByRole("button", { name: copy.newProject }));
      expect(onNewProject).toHaveBeenCalledWith(metrics);
    });

    it("hides New project when there is no handler for it", () => {
      renderPanel({ selectedId: "a1", previewArtifact: null, handlers: { onNewProject: undefined } });
      expect(within(details()).queryByRole("button", { name: copy.newProject })).not.toBeInTheDocument();
      expect(insertButton()).toBeInTheDocument();
    });

    it("hides Insert when there is no handler for it", () => {
      renderPanel({ selectedId: "a1", previewArtifact: null, handlers: { onInsert: undefined } });
      expect(within(details()).queryByRole("button", { name: copy.insert })).not.toBeInTheDocument();
      expect(within(details()).getByRole("button", { name: copy.newProject })).toBeInTheDocument();
    });

    it("shows no action buttons when neither handler is given", () => {
      renderPanel({ selectedId: "a1", previewArtifact: null, handlers: { onInsert: undefined, onNewProject: undefined } });
      expect(within(details()).queryAllByRole("button")).toHaveLength(0);
    });

    it("fills its view with no header of its own", () => {
      renderPanel({ previewArtifact: null });
      expect(screen.getByRole("complementary", { name: copy.title })).toHaveClass("w-full");
      expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    });
  });
});
