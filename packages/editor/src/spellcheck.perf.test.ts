// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { forceLinting } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createHarperLinter,
  diagnosticPresentationExtensions,
  refreshEditorProofreadingPresentation,
  setSpellHost,
} from "./spellcheck";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingResult,
} from "./proofreading";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

// Model: CLIP clip_paper.tex — ~300KB LaTeX, 901 diagnostics, page size 250.
function buildDoc(): string {
  const paragraph =
    "The masqueharde model transferresZero-shot classificaiton performence %\n";
  const block = paragraph.repeat(20); // ~2.9KB
  return `\\documentclass{article}\n\\begin{document}\n${block.repeat(105)}\n\\end{document}\n`;
}

function buildResult(count: number, docLength: number): ProofreadingResult {
  const diagnostics = Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i / count) * (docLength - 40));
    return {
      from,
      to: from + 12,
      message: `Possible misspelling ${i}`,
      kind: "Spelling",
      source: "hunspell",
      word: "misspelledword",
      suggestions: [],
    };
  });
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "result",
    requestId: 1,
    identity: {
      projectId: "project",
      path: "clip_paper.tex",
      revision: 1,
      requestGeneration: 1,
      surface: "source",
    },
    status: "ready",
    diagnostics,
  } as ProofreadingResult;
}

describe("presentation refresh perf (large doc)", () => {
  it("page flip stays cheap on a 300KB doc with 901 diagnostics", { timeout: 20_000 }, async () => {
      const text = buildDoc();
      let resolveProofreading: (r: ProofreadingResult) => void = () => {};
      const proofread = vi.fn(
        () =>
          new Promise<ProofreadingResult>((resolve) => {
            resolveProofreading = resolve;
          }),
      );
      const PAGE = 250;
      let page = 0;
      let dispatchCount = 0;
      setSpellHost({
        getProjectId: () => "project",
        getActivePath: () => "clip_paper.tex",
        getLintPrefs: () => ({
          showRegionalism: true,
          showWordChoice: true,
          dialect: "american",
        }),
        proofread,
        presentDiagnostics: (result) => {
          const from = page * PAGE;
          return result.diagnostics.slice(from, from + PAGE);
        },
        isSessionIgnored: () => false,
        isWordIgnored: () => false,
        ignoreWordForProject: () => undefined,
        ignoreWordGlobally: () => undefined,
      });

      view = new EditorView({
        state: EditorState.create({
          doc: text,
          extensions: [
            createHarperLinter(true),
            diagnosticPresentationExtensions(),
            EditorView.updateListener.of(() => {
              dispatchCount++;
            }),
          ],
        }),
        parent: document.body,
      });
      forceLinting(view);
      await vi.waitFor(() => expect(proofread).toHaveBeenCalledOnce(), {
        timeout: 5_000,
      });
      resolveProofreading(buildResult(901, text.length));
      await new Promise((r) => setTimeout(r, 50));

      // Act: flip to page 2 like the ProofreadingStatus pager does.
      page = 1;
      dispatchCount = 0;
      const t0 = performance.now();
      refreshEditorProofreadingPresentation(view);
      const syncMs = performance.now() - t0;

      // Let every queued microtask/rAF/promise repaint settle.
      await new Promise((r) => setTimeout(r, 200));
      const settleMs = performance.now() - t0;

      // eslint-disable-next-line no-console
      console.log(
        `sync: ${syncMs.toFixed(1)}ms, settled: ${settleMs.toFixed(1)}ms, dispatches: ${dispatchCount}, proofread calls: ${proofread.mock.calls.length}`,
      );
      expect(proofread.mock.calls.length).toBe(1); // no worker re-run
    });

    it("stale lint results landing after a page flip cannot loop", { timeout: 30_000 }, async () => {
      const text = buildDoc();
      const resolvers: Array<(r: ProofreadingResult) => void> = [];
      const proofread = vi.fn(
        () =>
          new Promise<ProofreadingResult>((resolve) => {
            resolvers.push(resolve);
          }),
      );
      const PAGE = 250;
      let page = 0;
      let dispatchCount = 0;
      let running = false;
      setSpellHost({
        getProjectId: () => "project",
        getActivePath: () => "clip_paper.tex",
        getLintPrefs: () => ({
          showRegionalism: true,
          showWordChoice: true,
          dialect: "american",
        }),
        proofread,
        presentDiagnostics: (result) => {
          const from = page * PAGE;
          return result.diagnostics.slice(from, from + PAGE);
        },
        isSessionIgnored: () => false,
        isWordIgnored: () => false,
        ignoreWordForProject: () => undefined,
        ignoreWordGlobally: () => undefined,
      });

      view = new EditorView({
        state: EditorState.create({
          doc: text,
          extensions: [
            createHarperLinter(true),
            diagnosticPresentationExtensions(),
            EditorView.updateListener.of((u) => {
              if (running && u.transactions.length) dispatchCount++;
            }),
          ],
        }),
        parent: document.body,
      });
      forceLinting(view);
      await vi.waitFor(() => expect(proofread).toHaveBeenCalled(), {
        timeout: 5_000,
      });
      // Simulate the observed 21 back-to-back re-lints (doc unchanged).
      for (let i = 0; i < 20 && i < 5_000; i++) {
        forceLinting(view);
        await Promise.resolve();
      }
      const queued = proofread.mock.calls.length;
      // Flip the page while all lint passes are still pending.
      page = 1;
      refreshEditorProofreadingPresentation(view);
      await new Promise((r) => setTimeout(r, 50));
      // Now every stale pass resolves at once with the full result.
      running = true;
      dispatchCount = 0;
      const result = buildResult(901, text.length);
      for (const resolve of resolvers.splice(0)) resolve(result);
      await new Promise((r) => setTimeout(r, 500));
      running = false;
      // eslint-disable-next-line no-console
      console.log(
        `queued lint passes: ${queued}, post-resolution dispatches: ${dispatchCount}`,
      );
      // A feedback loop would dispatch unboundedly; a healthy settle is small.
      expect(dispatchCount).toBeLessThan(60);
    });

    it("non-converging equality guard cannot freeze the app", { timeout: 15_000 }, async () => {
      const text = buildDoc();
      let resolveProofreading: (r: ProofreadingResult) => void = () => {};
      const proofread = vi.fn(
        () =>
          new Promise<ProofreadingResult>((resolve) => {
            resolveProofreading = resolve;
          }),
      );
      const PAGE = 250;
      let page = 0;
      let call = 0;
      let dispatchCount = 0;
      let running = false;
      setSpellHost({
        getProjectId: () => "project",
        getActivePath: () => "clip_paper.tex",
        getLintPrefs: () => ({
          showRegionalism: true,
          showWordChoice: true,
          dialect: "american",
        }),
        proofread,
        // Pathological: every presentation produces a different set, so the
        // repair equality guard can NEVER converge. Before the loop guard
        // this dispatched setDiagnostics forever inside microtasks.
        presentDiagnostics: (result) => {
          const from = page * PAGE + (call++ % 3);
          return result.diagnostics.slice(from, from + PAGE);
        },
        isSessionIgnored: () => false,
        isWordIgnored: () => false,
        ignoreWordForProject: () => undefined,
        ignoreWordGlobally: () => undefined,
      });

      view = new EditorView({
        state: EditorState.create({
          doc: text,
          extensions: [
            createHarperLinter(true),
            diagnosticPresentationExtensions(),
            EditorView.updateListener.of((u) => {
              if (running && u.transactions.length) dispatchCount++;
            }),
          ],
        }),
        parent: document.body,
      });
      forceLinting(view);
      await vi.waitFor(() => expect(proofread).toHaveBeenCalled(), {
        timeout: 5_000,
      });
      resolveProofreading(buildResult(901, text.length));
      await new Promise((r) => setTimeout(r, 50));
      running = true;
      dispatchCount = 0;
      page = 1;
      refreshEditorProofreadingPresentation(view);
      await new Promise((r) => setTimeout(r, 500));
      running = false;
      // eslint-disable-next-line no-console
      console.log(`non-converging dispatches: ${dispatchCount}`);
      expect(dispatchCount).toBeLessThan(40);
    });

    it("5,000-findings page flip stays interactive", { timeout: 20_000 }, async () => {
      const text = buildDoc();
      let resolveProofreading: (r: ProofreadingResult) => void = () => {};
      const proofread = vi.fn(
        () =>
          new Promise<ProofreadingResult>((resolve) => {
            resolveProofreading = resolve;
          }),
      );
      const PAGE = 5_000;
      let page = 0;
      setSpellHost({
        getProjectId: () => "project",
        getActivePath: () => "clip_paper.tex",
        getLintPrefs: () => ({
          showRegionalism: true,
          showWordChoice: true,
          dialect: "american",
        }),
        proofread,
        presentDiagnostics: (result) => {
          const from = page * PAGE;
          return result.diagnostics.slice(from, from + PAGE);
        },
        isSessionIgnored: () => false,
        isWordIgnored: () => false,
        ignoreWordForProject: () => undefined,
        ignoreWordGlobally: () => undefined,
      });
      view = new EditorView({
        state: EditorState.create({
          doc: text,
          extensions: [
            createHarperLinter(true),
            diagnosticPresentationExtensions(),
          ],
        }),
        parent: document.body,
      });
      forceLinting(view);
      await vi.waitFor(() => expect(proofread).toHaveBeenCalled(), {
        timeout: 5_000,
      });
      resolveProofreading(buildResult(12_000, text.length));
      await new Promise((r) => setTimeout(r, 50));
      page = 1;
      const t0 = performance.now();
      refreshEditorProofreadingPresentation(view);
      await new Promise((r) => setTimeout(r, 300));
      const ms = performance.now() - t0;
      // eslint-disable-next-line no-console
      console.log(`5k page flip settled in ${ms.toFixed(1)}ms`);
      expect(ms).toBeLessThan(450);
    });
});
