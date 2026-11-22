import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfAnnotation, PdfAnnotationList } from "@/lib/tauri";

const ipc = vi.hoisted(() => ({
  pdfAnnotationsList: vi.fn(),
  pdfAnnotationsAdd: vi.fn(),
  pdfAnnotationsUpdate: vi.fn(),
  pdfAnnotationsDelete: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ errorUnique: vi.fn() }));

vi.mock("@/lib/tauri", () => ipc);
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toasts }));

import { usePdfAnnotationsStore } from "./pdf-annotations";

function note(id: string, number: number): PdfAnnotation {
  return {
    id,
    number,
    kind: "comment",
    comment: "",
    quote: { text: "", before: "", after: "" },
    page: 1,
    source: null,
    boxes: [],
    build: null,
    origin: "pdf",
    status: "draft",
    placement: "placed",
    createdAt: 0,
    updatedAt: 0,
  };
}

function listed(items: PdfAnnotation[], patch: Partial<PdfAnnotationList> = {}): PdfAnnotationList {
  return { items, readOnly: false, setAside: false, ...patch };
}

const draft = {
  kind: "comment" as const,
  comment: "x",
  quote: { text: "", before: "", after: "" },
  page: 1,
  source: null,
  boxes: [],
  build: null,
  origin: "pdf" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  usePdfAnnotationsStore.setState({
    projectId: null,
    items: [],
    loaded: false,
    readOnly: false,
    setAside: false,
    activeId: null,
    error: null,
  });
});

describe("usePdfAnnotationsStore", () => {
  it("loads a project's annotations from the app", async () => {
    ipc.pdfAnnotationsList.mockResolvedValue(listed([note("a", 1)], { setAside: true }));
    await usePdfAnnotationsStore.getState().load("p1");
    expect(ipc.pdfAnnotationsList).toHaveBeenCalledWith("p1");
    expect(usePdfAnnotationsStore.getState()).toMatchObject({
      projectId: "p1",
      loaded: true,
      setAside: true,
      items: [note("a", 1)],
    });
  });

  it("keeps the error when loading fails, refuses changes, and tries again on the next load", async () => {
    ipc.pdfAnnotationsList.mockRejectedValueOnce(new Error("unreadable"));
    await usePdfAnnotationsStore.getState().load("p1");
    expect(usePdfAnnotationsStore.getState()).toMatchObject({ loaded: false, error: "unreadable" });
    expect(toasts.errorUnique).not.toHaveBeenCalled();
    expect(await usePdfAnnotationsStore.getState().add(draft)).toBeNull();
    expect(ipc.pdfAnnotationsAdd).not.toHaveBeenCalled();

    ipc.pdfAnnotationsList.mockResolvedValueOnce(listed([note("a", 1)]));
    await usePdfAnnotationsStore.getState().load("p1");
    expect(usePdfAnnotationsStore.getState()).toMatchObject({ loaded: true, error: null, items: [note("a", 1)] });
  });

  it("ignores a load that finishes after switching projects", async () => {
    let finish: (value: PdfAnnotationList) => void = () => {};
    ipc.pdfAnnotationsList.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    ipc.pdfAnnotationsList.mockResolvedValueOnce(listed([note("b", 1)]));
    const first = usePdfAnnotationsStore.getState().load("p1");
    await usePdfAnnotationsStore.getState().load("p2");
    finish(listed([note("a", 1)]));
    await first;
    expect(usePdfAnnotationsStore.getState().items).toEqual([note("b", 1)]);
  });

  it("refuses changes to a file saved by a newer version", async () => {
    ipc.pdfAnnotationsList.mockResolvedValue(listed([note("a", 1)], { readOnly: true }));
    await usePdfAnnotationsStore.getState().load("p1");
    expect(await usePdfAnnotationsStore.getState().update([{ id: "a", status: "sent" }])).toBe(false);
    expect(ipc.pdfAnnotationsUpdate).not.toHaveBeenCalled();
  });

  it("adds, updates and removes through the app and reports failures", async () => {
    ipc.pdfAnnotationsList.mockResolvedValue(listed([]));
    await usePdfAnnotationsStore.getState().load("p1");
    ipc.pdfAnnotationsAdd.mockResolvedValue(note("a", 7));
    const added = await usePdfAnnotationsStore.getState().add(draft);
    expect(added?.number).toBe(7);
    expect(usePdfAnnotationsStore.getState().activeId).toBe("a");

    ipc.pdfAnnotationsUpdate.mockResolvedValue([{ ...note("a", 7), status: "sent" }]);
    expect(await usePdfAnnotationsStore.getState().update([{ id: "a", status: "sent" }])).toBe(true);
    expect(usePdfAnnotationsStore.getState().items[0]?.status).toBe("sent");

    ipc.pdfAnnotationsUpdate.mockRejectedValueOnce(new Error("busy"));
    expect(await usePdfAnnotationsStore.getState().update([{ id: "a", page: 2 }], { quiet: true })).toBe(false);
    expect(toasts.errorUnique).not.toHaveBeenCalled();

    ipc.pdfAnnotationsDelete.mockRejectedValue(new Error("disk full"));
    expect(await usePdfAnnotationsStore.getState().remove(["a"])).toBe(false);
    expect(usePdfAnnotationsStore.getState().error).toBe("disk full");
    expect(toasts.errorUnique).toHaveBeenCalledWith("pdf-annotations", "disk full");

    ipc.pdfAnnotationsDelete.mockResolvedValue([]);
    expect(await usePdfAnnotationsStore.getState().remove(["a"])).toBe(true);
    expect(usePdfAnnotationsStore.getState()).toMatchObject({ items: [], activeId: null, error: null });
  });
});
