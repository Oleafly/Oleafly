import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadTypstParser } from "../../../typst";
import { EMPTY_TYPST_FORM_CATALOG, staticTypstForms } from "../../../typst-forms";
import { readTypstFormsFixture, typstFormsGolden } from "../../../typst-forms-test-support";
import { buildTypstDecorations } from "../field";
import { typstState } from "../test-support";
import { documentBindings, FormScope } from "./scope";

vi.mock("./scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scope")>();
  return { ...actual, documentBindings: vi.fn(actual.documentBindings) };
});

beforeAll(async () => {
  await loadTypstParser();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(documentBindings).mockClear();
});

const REPORT = Array.from({ length: 20 }, () => readTypstFormsFixture("project/report.typ")).join("\n");

function hashCalls(state: ReturnType<typeof typstState>): number {
  let count = 0;
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name === "FuncCall" && ref.node.prevSibling?.name === "Hash") count += 1;
    },
  });
  return count;
}

describe("the cost of forms in a decoration build", () => {
  it("never resolves a callee when the catalog is empty", () => {
    const state = typstState(REPORT, {
      ports: { resolveImage: async () => null, typstForms: staticTypstForms(EMPTY_TYPST_FORM_CATALOG) },
      path: "report.typ",
    });
    const resolve = vi.spyOn(FormScope.prototype, "resolve");
    buildTypstDecorations(state, syntaxTree(state));
    expect(resolve).not.toHaveBeenCalled();
    expect(documentBindings).not.toHaveBeenCalled();
  });

  it("resolves each #-call at most once per build", () => {
    const state = typstState(REPORT, {
      ports: { resolveImage: async () => null, typstForms: staticTypstForms(typstFormsGolden()) },
      path: "report.typ",
    });
    const resolve = vi.spyOn(FormScope.prototype, "resolve");
    buildTypstDecorations(state, syntaxTree(state));
    expect(resolve.mock.calls.length).toBeGreaterThan(0);
    expect(resolve.mock.calls.length).toBeLessThanOrEqual(hashCalls(state));
  });

  it("reads the document's bindings once per tree and never asks the port during builds", () => {
    const port = staticTypstForms(typstFormsGolden());
    const snapshot = vi.spyOn(port, "snapshot");
    let state = typstState(REPORT, { ports: { resolveImage: async () => null, typstForms: port }, path: "report.typ" });
    snapshot.mockClear();
    vi.mocked(documentBindings).mockClear();
    for (let round = 0; round < 50; round += 1) {
      state = state.update({ selection: EditorSelection.cursor(round * 7) }).state;
    }
    const results = new Set(vi.mocked(documentBindings).mock.results.map((result) => result.value));
    expect(vi.mocked(documentBindings).mock.calls.length).toBeGreaterThan(0);
    expect(results.size).toBe(1);
    expect(snapshot).not.toHaveBeenCalled();
  });
});
