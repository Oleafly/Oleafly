import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "@oleafly/editor/typst";
import { EMPTY_TYPST_FORM_CATALOG, staticTypstForms, type TypstFormCatalog } from "@oleafly/editor/typst-forms";
import { typstFormsGolden } from "@oleafly/editor/typst-forms-test-support";
import { buildTypstDecorations } from "@oleafly/editor/visual/typst/field";
import { typstState } from "@oleafly/editor/visual/typst/test-support";

const WARMUP_RUNS = 5;
const MEASURED_RUNS = 40;
const FORM_CALLS = 1_000;

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] ?? 0;
}

// Runs the operations in turn, starting each round with the next one, so a busy machine or a
// garbage collection slows each of them about the same.
function interleaved(operations: readonly (() => void)[]): { median: number; p95: number }[] {
  for (let run = 0; run < WARMUP_RUNS; run++) for (const operation of operations) operation();
  const samples = operations.map((): number[] => []);
  for (let run = 0; run < MEASURED_RUNS; run++) {
    for (let step = 0; step < operations.length; step++) {
      const index = (run + step) % operations.length;
      const start = performance.now();
      operations[index]();
      samples[index].push(performance.now() - start);
    }
  }
  return samples.map((values) => ({ median: percentile(values, 0.5), p95: percentile(values, 0.95) }));
}

// About 5,000 lines: headings, prose and 1,000 form calls, half on their own lines and half inline.
function largeReport(): string {
  const lines = [
    '#import "@local/acme-report:0.1.0" as acme',
    '#import "@local/acme-report:0.1.0": info-box, status-badge as badge',
    '#set page(paper: "a4")',
    "",
  ];
  for (let index = 0; index < FORM_CALLS / 2; index += 1) {
    lines.push(
      `= Finding ${index + 1}`,
      "",
      `#info-box(title: "Finding ${index + 1}", tone: "${index % 2 === 0 ? "note" : "risk"}")[Body *text* for finding ${index + 1}.]`,
      "",
      `The status is #badge("${["draft", "review", "approved"][index % 3]}") and the owner is _named_ later.`,
      "Some more prose follows with a link to #link(\"https://example.com\")[a page].",
      "",
      "- a list item",
      "- another one",
      "",
    );
  }
  return lines.join("\n");
}

function stateWith(doc: string, catalog: TypstFormCatalog | null): EditorState {
  const ports = { resolveImage: async () => null, typstForms: catalog ? staticTypstForms(catalog) : undefined };
  return typstState(doc, { ports, path: "report.typ", cursor: doc.length });
}

function rebuild(state: EditorState): () => void {
  const tree = syntaxTree(state);
  return () => buildTypstDecorations(state, tree);
}

beforeAll(async () => {
  await loadTypstParser();
});

describe("Typst function forms decoration cost", () => {
  it("costs nothing measurable without forms and stays inside the budget with 1,000 of them", () => {
    const doc = largeReport();
    expect(doc.split("\n").length).toBeGreaterThanOrEqual(5_000);
    const [base, empty, forms] = interleaved([
      rebuild(stateWith(doc, null)),
      rebuild(stateWith(doc, EMPTY_TYPST_FORM_CATALOG)),
      rebuild(stateWith(doc, typstFormsGolden())),
    ]);
    const report = (name: string, value: { median: number; p95: number }) =>
      `${name} ${value.median.toFixed(2)} / ${value.p95.toFixed(2)} ms`;
    process.stdout.write(
      `typst forms rebuild, median / p95: ${report("no port", base)}, ${report("empty catalog", empty)}, ` +
        `${report(`${FORM_CALLS} forms`, forms)}\n`,
    );
    // An empty catalog runs the no-port code path, so its p95 differs only by timer and
    // collector noise; the median is the honest comparison there.
    expect(empty.median).toBeLessThanOrEqual(base.median * 1.05 + 0.5);
    expect(forms.p95).toBeLessThanOrEqual(base.p95 * 1.25 + 2);
  });
});
