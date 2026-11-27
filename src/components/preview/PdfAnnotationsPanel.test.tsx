// @vitest-environment jsdom
import { loadNamespace } from "@/i18n";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enAnnotations from "@/i18n/locales/en/annotations.json" with { type: "json" };
import type { PdfAnnotation } from "@/lib/tauri";
import { usePdfAnnotationsStore } from "@/store/pdf-annotations";
import { PdfAnnotationsPanel } from "./PdfAnnotationsPanel";

const strings = enAnnotations;
const label = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, String(value)), text);

const mocks = vi.hoisted(() => ({
  confirmAction: vi.fn(async () => true),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/store/confirm-dialog", () => ({ confirmAction: mocks.confirmAction }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  pdfAnnotationsUpdate: mocks.update,
  pdfAnnotationsDelete: mocks.remove,
}));

function note(patch: Partial<PdfAnnotation> = {}): PdfAnnotation {
  return {
    id: "a",
    number: 1,
    kind: "comment",
    comment: "Say what the bound depends on.",
    quote: { text: "the bound holds", before: "", after: "" },
    page: 2,
    source: { path: "sections/proof.tex", startLine: 40, endLine: 42, excerpt: "" },
    boxes: [],
    build: "current",
    origin: "pdf",
    status: "draft",
    placement: "placed",
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

function renderPanel(props: Partial<Parameters<typeof PdfAnnotationsPanel>[0]> = {}) {
  const handlers = { onSend: vi.fn(), onShow: vi.fn(), onPlaceAgain: vi.fn(), onClose: vi.fn() };
  render(<PdfAnnotationsPanel id="annotations" open placingId={null} {...handlers} {...props} />);
  return handlers;
}

function seed(items: PdfAnnotation[], error: string | null = null, notices: { readOnly?: boolean; setAside?: boolean } = {}) {
  usePdfAnnotationsStore.setState({
    projectId: "p",
    items,
    loaded: true,
    readOnly: notices.readOnly ?? false,
    setAside: notices.setAside ?? false,
    activeId: null,
    error,
  });
}

beforeAll(async () => {
  await loadNamespace("annotations");
});

const group = (title: string, count: number) => screen.getByRole("region", { name: `${title} · ${count}` });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seed([]);
});

describe("PdfAnnotationsPanel", () => {
  it("explains how to annotate when there is nothing yet", () => {
    renderPanel();
    expect(screen.getByText(strings.panel.empty)).toBeTruthy();
  });

  it("groups notes by status and shows each one's kind, location, quote and comment", () => {
    seed([
      note(),
      note({ id: "b", number: 2, kind: "region", status: "sent", source: null, quote: { text: "", before: "", after: "" } }),
      note({ id: "c", number: 3, status: "addressed" }),
    ]);
    renderPanel();
    const drafts = group(strings.panel.groups.drafts, 1);
    expect(within(drafts).getByText(strings.kind.comment)).toBeTruthy();
    expect(within(drafts).getByText("sections/proof.tex:40-42 · p. 2")).toBeTruthy();
    expect(within(drafts).getByText(label(strings.panel.quoted, { quote: "the bound holds" }))).toBeTruthy();
    expect(within(drafts).getByText("Say what the bound depends on.")).toBeTruthy();
    const assistant = group(strings.panel.groups.assistant, 2);
    expect(within(assistant).getByText(strings.kind.region)).toBeTruthy();
    expect(within(assistant).getByText("p. 2")).toBeTruthy();
    expect(within(assistant).getByText(strings.status.addressed)).toBeTruthy();
  });

  it("shows what a replace, insert and delete change", () => {
    seed([
      note({ kind: "replace", comment: "the bound is tight" }),
      note({ id: "b", number: 2, kind: "insert", comment: "for every n" }),
      note({ id: "c", number: 3, kind: "delete", comment: "" }),
    ]);
    renderPanel();
    const [replace, insert, remove] = within(group(strings.panel.groups.drafts, 3)).getAllByRole("listitem");
    expect(within(replace).getByText("the bound holds")).toHaveClass("line-through");
    expect(within(replace).getByRole("button", { name: "the bound is tight" })).toBeTruthy();
    expect(within(insert).getByText(label(strings.panel.insertAfter, { quote: "the bound holds" }))).toBeTruthy();
    expect(within(insert).getByRole("button", { name: "for every n" })).toBeTruthy();
    expect(within(remove).getByText("the bound holds")).toHaveClass("line-through");
  });

  it("folds Resolved until it is opened, and remembers that for each project", async () => {
    seed([note({ status: "resolved", comment: "Done already." })]);
    const { unmount } = render(
      <PdfAnnotationsPanel id="annotations" open placingId={null} onSend={vi.fn()} onShow={vi.fn()} onPlaceAgain={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByText("Done already.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: `${strings.status.resolved} · 1` }));
    expect(screen.getByText("Done already.")).toBeTruthy();
    unmount();

    renderPanel();
    expect(screen.getByText("Done already.")).toBeTruthy();
    cleanup();

    seed([note({ status: "resolved", comment: "Done already." })]);
    usePdfAnnotationsStore.setState({ projectId: "other" });
    renderPanel();
    expect(screen.queryByText("Done already.")).toBeNull();
  });

  it("opens a folded group when its note becomes the active one", () => {
    seed([note({ status: "resolved", comment: "Done already." })]);
    renderPanel();
    expect(screen.queryByText("Done already.")).toBeNull();
    act(() => usePdfAnnotationsStore.setState({ activeId: "a" }));
    expect(screen.getByText("Done already.")).toBeTruthy();
  });

  it("scrolls the active note into its list without scrolling anything around the panel", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this.hasAttribute("data-side-panel-body") ? rect(0, 100) : rect(150, 190);
    });
    seed([note(), note({ id: "b", number: 2 })]);
    usePdfAnnotationsStore.setState({ activeId: "b" });
    renderPanel();
    const body = document.querySelector<HTMLElement>("[data-side-panel-body]") as HTMLElement;
    expect(body.scrollTop).toBe(90);
    expect(scrollIntoView).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("picks open notes to send by default and sends the ticked ones", async () => {
    seed([note(), note({ id: "b", number: 2, status: "sent" })]);
    const { onSend } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: label(strings.panel.send, { n: 1 }) }));
    expect(onSend).toHaveBeenCalledWith([note()]);
    const include = screen.getByRole("button", { name: label(strings.panel.include, { number: 2 }), pressed: false });
    await userEvent.click(include);
    expect(include).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: label(strings.panel.send, { n: 2 }) }));
    expect(onSend).toHaveBeenLastCalledWith([note(), note({ id: "b", number: 2, status: "sent" })]);
  });

  it("marks a note resolved, edits its comment and deletes it", async () => {
    seed([note()]);
    mocks.update.mockResolvedValue([note({ status: "resolved" })]);
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: label(strings.panel.resolve, { number: 1 }) }));
    expect(mocks.update).toHaveBeenCalledWith("p", [{ id: "a", status: "resolved" }]);
    await userEvent.click(await screen.findByRole("button", { name: `${strings.status.resolved} · 1` }));
    expect(screen.getByRole("button", { name: label(strings.panel.reopen, { number: 1 }) })).toBeTruthy();

    mocks.update.mockResolvedValue([note({ comment: "New comment", status: "resolved" })]);
    await userEvent.click(screen.getByRole("button", { name: "Say what the bound depends on." }));
    const field = screen.getByRole("textbox");
    await userEvent.clear(field);
    await userEvent.type(field, "New comment");
    await userEvent.click(screen.getByRole("button", { name: strings.composer.save }));
    expect(mocks.update).toHaveBeenLastCalledWith("p", [{ id: "a", comment: "New comment" }]);

    mocks.remove.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: label(strings.panel.delete, { number: 1 }) }));
    expect(mocks.remove).toHaveBeenCalledWith("p", ["a"]);
  });

  it("offers Place again for a note that wasn't found, and keeps its status", async () => {
    seed([note({ status: "sent", placement: "needsPlacing" })]);
    const { onPlaceAgain } = renderPanel();
    expect(within(group(strings.status.needsPlacing, 1)).getByText(strings.panel.notFound)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: strings.panel.placeAgain }));
    expect(onPlaceAgain).toHaveBeenCalledWith(note({ status: "sent", placement: "needsPlacing" }));
  });

  it("renders a comment's formatting instead of its markers", () => {
    seed([note({ comment: "Make it **shorter**." })]);
    renderPanel();
    expect(screen.getByText("shorter")).toBeTruthy();
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("says when the file is read-only or was set aside", () => {
    seed([], null, { readOnly: true, setAside: true });
    renderPanel();
    expect(screen.getByText(strings.panel.readOnly)).toBeTruthy();
    expect(screen.getByText(strings.panel.setAside)).toBeTruthy();
  });

  it("shows a save failure", () => {
    seed([note()], "disk full");
    renderPanel();
    expect(screen.getByRole("alert").textContent).toBe(label(strings.panel.failed, { error: "disk full" }));
  });

  it("asks before deleting all notes", async () => {
    seed([note(), note({ id: "b", number: 2 })]);
    mocks.remove.mockResolvedValue([]);
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: strings.panel.clear }));
    expect(mocks.confirmAction).toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith("p", ["a", "b"]);
  });
});
