// @vitest-environment jsdom
import { loadNamespace } from "@/i18n";
import { render, screen, within } from "@testing-library/react";
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

setActiveProject: vi.fn().mockResolvedValue(undefined),
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

beforeEach(() => {
  vi.clearAllMocks();
  seed([]);
});

describe("PdfAnnotationsPanel", () => {
  it("explains how to annotate when there is nothing yet", () => {
    renderPanel();
    expect(screen.getByText(strings.panel.empty)).toBeTruthy();
  });

  it("shows each note's kind, status, location, quote and comment", () => {
    seed([note(), note({ id: "b", number: 2, kind: "region", status: "sent", source: null, quote: { text: "", before: "", after: "" } })]);
    renderPanel();
    const first = screen.getByText("sections/proof.tex:40-42").closest("li") as HTMLElement;
    expect(within(first).getByText(strings.kind.comment)).toBeTruthy();
    expect(within(first).getByText(strings.status.draft)).toBeTruthy();
    expect(within(first).getByText("the bound holds")).toBeTruthy();
    expect(within(first).getByText("Say what the bound depends on.")).toBeTruthy();
    const second = screen.getByText(strings.panel.noSource).closest("li") as HTMLElement;
    expect(within(second).getByText(strings.kind.region)).toBeTruthy();
    expect(within(second).getByText(strings.status.sent)).toBeTruthy();
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

  it("marks a note resolved, edits its comment and deletes it", async () => {
    seed([note()]);
    mocks.update.mockResolvedValue([note({ status: "resolved" })]);
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: label(strings.panel.resolve, { number: 1 }) }));
    expect(mocks.update).toHaveBeenCalledWith("p", [{ id: "a", status: "resolved" }]);
    expect(await screen.findByRole("button", { name: label(strings.panel.reopen, { number: 1 }) })).toBeTruthy();

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
    expect(screen.getByText(strings.panel.notFound)).toBeTruthy();
    expect(screen.getByText(strings.status.sent)).toBeTruthy();
    expect(screen.getByText(strings.status.needsPlacing)).toBeTruthy();
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
