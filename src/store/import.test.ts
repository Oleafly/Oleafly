import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConvertResult, PageInput } from "@oleafly/pdf-to-latex";

const mocks = vi.hoisted(() => ({
  extractPagesForConvert: vi.fn(),
  convertPages: vi.fn(),
}));

vi.mock("@oleafly/pdf-to-latex/pdf-adapter", () => ({
  extractPagesForConvert: mocks.extractPagesForConvert,
}));

vi.mock("@oleafly/pdf-to-latex", () => ({
  convertPages: mocks.convertPages,
}));

import { useImportStore } from "./import";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function page(label: string): PageInput {
  return {
    width: 612,
    height: 792,
    items: [
      {
        str: label,
        x: 10,
        y: 10,
        width: 20,
        height: 10,
        fontName: "Test",
        fontSize: 10,
      },
    ],
    figureNames: [],
  };
}

function result(label: string): ConvertResult {
  return {
    tex: label,
    report: {
      pages: 1,
      headings: 0,
      paragraphs: 1,
      equations: 0,
      figures: 0,
      likelyScanned: false,
      notes: [],
    },
  };
}

beforeEach(() => {
  mocks.extractPagesForConvert.mockReset();
  mocks.convertPages.mockReset().mockImplementation((pages: PageInput[]) =>
    result(pages[0]?.items[0]?.str ?? "empty"),
  );
  useImportStore.getState().close();
});

describe("PDF import request identity", () => {
  it("keeps a newer PDF when an older extraction resolves last", async () => {
    const first = deferred<{ pages: PageInput[]; figures: [] }>();
    const second = deferred<{ pages: PageInput[]; figures: [] }>();
    mocks.extractPagesForConvert
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const openingFirst = useImportStore
      .getState()
      .openWithPdf(new Uint8Array([1]), "first.pdf");
    await vi.waitFor(() =>
      expect(mocks.extractPagesForConvert).toHaveBeenCalledTimes(1),
    );
    const openingSecond = useImportStore
      .getState()
      .openWithPdf(new Uint8Array([2]), "second.pdf");
    await vi.waitFor(() =>
      expect(mocks.extractPagesForConvert).toHaveBeenCalledTimes(2),
    );

    second.resolve({ pages: [page("second")], figures: [] });
    await openingSecond;
    expect(useImportStore.getState().fileName).toBe("second.pdf");
    expect(useImportStore.getState().result?.tex).toBe("second");

    first.resolve({ pages: [page("first")], figures: [] });
    await openingFirst;
    expect(useImportStore.getState().fileName).toBe("second.pdf");
    expect(useImportStore.getState().result?.tex).toBe("second");
    expect(useImportStore.getState().busy).toBe(false);
  });

  it("invalidates an extraction when the import view closes", async () => {
    const extraction = deferred<{ pages: PageInput[]; figures: [] }>();
    mocks.extractPagesForConvert.mockReturnValue(extraction.promise);
    const opening = useImportStore
      .getState()
      .openWithPdf(new Uint8Array([1]), "closing.pdf");
    await vi.waitFor(() =>
      expect(mocks.extractPagesForConvert).toHaveBeenCalledOnce(),
    );

    useImportStore.getState().close();
    extraction.resolve({ pages: [page("late")], figures: [] });
    await opening;

    const state = useImportStore.getState();
    expect(state.open).toBe(false);
    expect(state.busy).toBe(false);
    expect(state.pages).toEqual([]);
    expect(state.result).toBeNull();
    expect(state.error).toBeNull();
  });

  it("does not surface a stale extraction rejection over the current PDF", async () => {
    const first = deferred<{ pages: PageInput[]; figures: [] }>();
    const second = deferred<{ pages: PageInput[]; figures: [] }>();
    mocks.extractPagesForConvert
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const openingFirst = useImportStore
      .getState()
      .openWithPdf(new Uint8Array([1]), "first.pdf");
    await vi.waitFor(() =>
      expect(mocks.extractPagesForConvert).toHaveBeenCalledTimes(1),
    );
    const openingSecond = useImportStore
      .getState()
      .openWithPdf(new Uint8Array([2]), "second.pdf");
    await vi.waitFor(() =>
      expect(mocks.extractPagesForConvert).toHaveBeenCalledTimes(2),
    );
    second.resolve({ pages: [page("second")], figures: [] });
    await openingSecond;

    first.reject(new Error("old worker failed"));
    await openingFirst;

    expect(useImportStore.getState().fileName).toBe("second.pdf");
    expect(useImportStore.getState().error).toBeNull();
    expect(useImportStore.getState().result?.tex).toBe("second");
  });
});
