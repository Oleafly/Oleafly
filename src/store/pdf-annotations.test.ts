import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfAnnotation } from "@/lib/tauri";

const ipc = vi.hoisted(() => ({
  pdfAnnotationsList: vi.fn(),
  pdfAnnotationsAdd: vi.fn(),
  pdfAnnotationsUpdate: vi.fn(),
  pdfAnnotationsDelete: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ipc);
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

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
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePdfAnnotationsStore.setState({ projectId: null, items: [], loaded: false, activeId: null, error: null });
});

describe("usePdfAnnotationsStore", () => {
  it("loads a project's annotations from the app", async () => {
    ipc.pdfAnnotationsList.mockResolvedValue([note("a", 1)]);
    await usePdfAnnotationsStore.getState().load("p1");
    expect(ipc.pdfAnnotationsList).toHaveBeenCalledWith("p1");
    expect(usePdfAnnotationsStore.getState()).toMatchObject({ projectId: "p1", loaded: true, items: [note("a", 1)] });
  });

  it("keeps the error when loading fails instead of showing an empty list as saved", async () => {
    ipc.pdfAnnotationsList.mockRejectedValue(new Error("unreadable"));
    await usePdfAnnotationsStore.getState().load("p1");
    expect(usePdfAnnotationsStore.getState()).toMatchObject({ loaded: false, error: "unreadable" });
  });

  it("ignores a load that finishes after switching projects", async () => {
    let finish: (items: PdfAnnotation[]) => void = () => {};
    ipc.pdfAnnotationsList.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    ipc.pdfAnnotationsList.mockResolvedValueOnce([note("b", 1)]);
    const first = usePdfAnnotationsStore.getState().load("p1");
    await usePdfAnnotationsStore.getState().load("p2");
    finish([note("a", 1)]);
    await first;
    expect(usePdfAnnotationsStore.getState().items).toEqual([note("b", 1)]);
  });

  it("adds, updates and removes through the app and reports failures", async () => {
    ipc.pdfAnnotationsList.mockResolvedValue([]);
    await usePdfAnnotationsStore.getState().load("p1");
    ipc.pdfAnnotationsAdd.mockResolvedValue(note("a", 7));
    const added = await usePdfAnnotationsStore.getState().add({
      kind: "comment",
      comment: "x",
      quote: { text: "", before: "", after: "" },
      page: 1,
      source: null,
      boxes: [],
      build: null,
      origin: "pdf",
    });
    expect(added?.number).toBe(7);
    expect(usePdfAnnotationsStore.getState().activeId).toBe("a");

    ipc.pdfAnnotationsUpdate.mockResolvedValue([{ ...note("a", 7), status: "sent" }]);
    expect(await usePdfAnnotationsStore.getState().update([{ id: "a", status: "sent" }])).toBe(true);
    expect(usePdfAnnotationsStore.getState().items[0]?.status).toBe("sent");

    ipc.pdfAnnotationsDelete.mockRejectedValue(new Error("disk full"));
    expect(await usePdfAnnotationsStore.getState().remove(["a"])).toBe(false);
    expect(usePdfAnnotationsStore.getState().error).toBe("disk full");

    ipc.pdfAnnotationsDelete.mockResolvedValue([]);
    expect(await usePdfAnnotationsStore.getState().remove(["a"])).toBe(true);
    expect(usePdfAnnotationsStore.getState()).toMatchObject({ items: [], activeId: null, error: null });
  });
});
