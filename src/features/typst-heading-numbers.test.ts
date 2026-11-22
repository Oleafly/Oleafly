import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import type { TypstDocumentInsightsResult, TypstInsightElement } from "./typst-insights";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), logWarning: vi.fn() }));
vi.mock("./typst-insights", () => ({ fetchTypstDocumentInsights: mocks.fetch }));
vi.mock("@/lib/log", () => ({ logWarning: mocks.logWarning }));
vi.mock("@/lib/document-engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/document-engine")>()),
  compileOfflineForEngine: () => ({ offline: true, notice: null }),
}));
vi.mock("@/store/typst-variant", () => ({ activeTypstVariant: () => null }));

import { clearTypstNumbers, currentTypstToc, refreshTypstNumbers } from "./typst-heading-numbers";

function checkpoint(outputId: string, mainDocument = "main.typ"): CompileSuccessCheckpoint {
  return {
    version: 1,
    projectId: "p1",
    mainDocument,
    projectRevision: 1,
    requestGeneration: 1,
    outputKind: "standard",
    producerId: "typst",
    outputRevision: 1,
    outputId,
    completedAt: 0,
  };
}

function heading(text: string, level: number, number: string | null, page: number | null): TypstInsightElement {
  return { kind: "heading", text, label: null, level, figureKind: null, numbered: number !== null, number, page };
}

function ready(elements: TypstInsightElement[]): TypstDocumentInsightsResult {
  return { status: "ready", typstVersion: "0.15.1", method: "eval", elements, truncated: false };
}

afterEach(() => {
  clearTypstNumbers();
  vi.clearAllMocks();
});

describe("refreshTypstNumbers", () => {
  it("reads each compile's heading numbers once, as a table of contents", async () => {
    mocks.fetch.mockResolvedValue(
      ready([
        heading("Introduction", 1, "1", 1),
        { ...heading("Plot", 1, null, 2), kind: "figure" },
        heading("A lemma", 2, "A.1", null),
      ]),
    );
    await refreshTypstNumbers(checkpoint("out-1"));
    await refreshTypstNumbers(checkpoint("out-1"));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith("p1", true, null);
    expect(currentTypstToc()).toEqual({
      projectId: "p1",
      mainDocument: "main.typ",
      entries: [
        { level: 0, number: "1", title: "Introduction", page: "1" },
        { level: 1, number: "A.1", title: "A lemma", page: null },
      ],
    });
  });

  it("keeps the last numbers when a query fails, logs a broken one, and skips other engines", async () => {
    mocks.fetch.mockResolvedValueOnce(ready([heading("Intro", 1, "1", 1)]));
    await refreshTypstNumbers(checkpoint("out-1"));
    mocks.fetch.mockResolvedValueOnce({ status: "failed", typstVersion: "0.15.1", method: "eval", diagnostics: [] });
    await refreshTypstNumbers(checkpoint("out-2"));
    const broken = new Error("no typst");
    mocks.fetch.mockRejectedValueOnce(broken);
    await refreshTypstNumbers(checkpoint("out-3"));
    expect(currentTypstToc()?.entries.map((entry) => entry.number)).toEqual(["1"]);
    expect(mocks.logWarning).toHaveBeenCalledWith("read the Typst heading numbers", broken);

    await refreshTypstNumbers(checkpoint("out-4", "main.tex"));
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("drops an answer that arrives after a newer compile asked", async () => {
    let answer: (result: TypstDocumentInsightsResult) => void = () => undefined;
    mocks.fetch.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const first = refreshTypstNumbers(checkpoint("out-1"));
    mocks.fetch.mockResolvedValueOnce(ready([heading("New", 1, "1", 1)]));
    await refreshTypstNumbers(checkpoint("out-2"));
    answer(ready([heading("Old", 1, "9", 1)]));
    await first;
    expect(currentTypstToc()?.entries.map((entry) => entry.title)).toEqual(["New"]);
  });
});
