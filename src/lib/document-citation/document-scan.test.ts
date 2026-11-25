import { describe, expect, it } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { scanDocumentForCitations } from "./document-scan";

const source = String.raw`
\begin{document}
Graph neural networks enable molecule generation with high fidelity in practice.

Another paragraph about transformers for protein folding is also important here.
\end{document}
`;

describe("scanDocumentForCitations progress and failures", () => {
  const settings = {
    scoreThreshold: 0,
    maxResultsPerSource: 5,
    maxResultsPerParagraph: 2,
    maxParagraphs: 20,
  };
  const copy = enCore.documentScan;

  it("reports a failed search and rethrows it", async () => {
    const progress: Array<{ phase: string; message?: string }> = [];
    await expect(
      scanDocumentForCitations({
        sourceText: source,
        bibText: "",
        settings,
        search: async () => {
          throw new Error("search offline");
        },
        onProgress: (step) => progress.push(step),
      }),
    ).rejects.toThrow("search offline");
    expect(progress.at(-1)).toMatchObject({ phase: "error", message: "search offline" });
  });

  it("uses the catalog message for a failure that is not an error object", async () => {
    const progress: Array<{ phase: string; message?: string }> = [];
    await expect(
      scanDocumentForCitations({
        sourceText: source,
        bibText: "",
        settings,
        search: async () => {
          throw "offline";
        },
        onProgress: (step) => progress.push(step),
      }),
    ).rejects.toBe("offline");
    expect(progress.at(-1)).toMatchObject({ phase: "error", message: copy.failed });
  });
});
