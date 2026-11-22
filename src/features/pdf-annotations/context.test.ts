import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfAnnotation } from "@/lib/tauri";

const ipc = vi.hoisted(() => ({ pdfAnnotationsUpdate: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  pdfAnnotationsUpdate: ipc.pdfAnnotationsUpdate,
}));
vi.mock("@/features/synctex", () => ({ sourceText: () => "intro\nthe result holds here\n" }));

import { expandComposerContext, markComposerContextSent } from "@/lib/composer-context";
import { usePdfAnnotationsStore } from "@/store/pdf-annotations";
import { annotationContextItems } from "./context";

function note(patch: Partial<PdfAnnotation> = {}): PdfAnnotation {
  return {
    id: "a",
    number: 3,
    kind: "comment",
    comment: "Say why.",
    quote: { text: "holds", before: "the result ", after: " here" },
    page: 2,
    source: { path: "main.tex", startLine: 9, endLine: 9, excerpt: "the result holds here" },
    boxes: [],
    build: "b",
    origin: "pdf",
    status: "draft",
    placement: "placed",
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ipc.pdfAnnotationsUpdate.mockImplementation(async () => usePdfAnnotationsStore.getState().items);
  usePdfAnnotationsStore.setState({
    projectId: "p",
    items: [note(), note({ id: "b", number: 4, status: "sent", source: null })],
    loaded: true,
    readOnly: false,
    setAside: false,
    activeId: null,
    error: null,
  });
});

describe("PDF annotation context", () => {
  it("writes each annotation with lines checked against the current file", async () => {
    const expanded = await expandComposerContext("p", annotationContextItems([note()]));
    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toMatchObject({ refId: "a", path: "main.tex", heading: "PDF annotation 3" });
    expect(expanded[0]?.text).toContain("Location: main.tex:2 (page 2)");
    expect(expanded[0]?.text).toContain("Comment: Say why.");
  });

  it("finds nothing for another project or an annotation that's gone", async () => {
    expect(await expandComposerContext("other", annotationContextItems([note()]))).toEqual([]);
    expect(await expandComposerContext("p", annotationContextItems([note({ id: "gone" })]))).toEqual([]);
  });

  it("marks only drafts as sent", () => {
    markComposerContextSent("p", annotationContextItems([note(), note({ id: "b", number: 4, status: "sent" })]));
    expect(ipc.pdfAnnotationsUpdate).toHaveBeenCalledExactlyOnceWith("p", [{ id: "a", status: "sent" }]);
  });
});
