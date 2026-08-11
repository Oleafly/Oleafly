import { test, expect } from "../fixtures";
import {
  createBlankProject,
  expectDesktopShellAnchored,
  openProject,
  replaceEditorSource,
  writeProjectText,
} from "../helpers";
import {
  buildLargeLatexBookProject,
  LARGE_BOOK_LINE_COUNT,
} from "../../test/fixtures/editor-support/large-book";

// 58-editor-core-stability drives one fixed scripted pass over a 6,200-line
// book. That caught the obvious breakages, but a single fixed path cannot find
// the ones that only appear at a particular position or interleaving. These
// scenarios reuse the same document and vary WHERE and WHEN the user acts:
// extremes, pseudo-random positions that differ per run, scrolling that never
// settles, and edits landing in the middle of that motion.
//
// Every scenario ends in the same coherence check, so a failure names the
// interaction that broke the editor rather than just "the chaos test failed".

const PROJECT = "E2E Large Interaction";

// Varies per run so repeated runs explore different lines, and is printed so a
// failure can be replayed exactly.
const SEED = Number(process.env.E2E_INTERACTION_SEED ?? Date.now() % 100_000);

function seededLines(count: number): number[] {
  // Mulberry32: small, deterministic, good enough to spread positions.
  let state = SEED >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () =>
    Math.max(1, Math.min(LARGE_BOOK_LINE_COUNT, Math.floor(next() * LARGE_BOOK_LINE_COUNT) + 1)),
  );
}

interface Coherence {
  readonly visibleLines: number;
  readonly visibleGutters: number;
  readonly maxGutterDelta: number;
  readonly misalignedGutters: number;
  readonly documentScrollLeak: boolean;
  readonly currentLine: number;
  readonly docLines: number;
}

// Frame waits are raced against a timer: an occluded WebView stops firing
// requestAnimationFrame altogether, and a probe that waits on it alone hangs
// until the harness times out with nothing to show for it.
const FRAME_HELPER = `
  const nextFrame = () =>
    new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(undefined); } };
      requestAnimationFrame(finish);
      setTimeout(finish, 100);
    });
`;

async function coherence(
  page: Parameters<typeof expectDesktopShellAnchored>[0],
): Promise<Coherence> {
  return page.evaluate<Coherence>(
    `import("/src/components/editor/cm/controller.ts").then(({ getCurrentLine, getEditorView }) => {
      const view = getEditorView();
      if (!view) throw new Error("editor is unavailable");
      const viewport = view.scrollDOM.getBoundingClientRect();
      const visible = Array.from(view.contentDOM.querySelectorAll(".cm-line")).filter((line) => {
        const rect = line.getBoundingClientRect();
        return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
      });
      const gutters = Array.from(
        view.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
      ).filter(
        (element) => {
          const rect = element.getBoundingClientRect();
          return /^\\d+$/.test(element.textContent?.trim() ?? "") &&
            element.style.visibility !== "hidden" &&
            rect.top >= viewport.top &&
            rect.bottom <= viewport.bottom;
        },
      );
      const gutterGeometry = gutters.flatMap((gutter) => {
        const lineNumber = Number(gutter.textContent?.trim());
        if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > view.state.doc.lines) {
          return [];
        }
        const domPosition = view.domAtPos(view.state.doc.line(lineNumber).from, 1);
        const element =
          domPosition.node.nodeType === Node.ELEMENT_NODE
            ? domPosition.node
            : domPosition.node.parentElement;
        const line = element?.closest?.(".cm-line");
        if (!line) return [];
        const gutterRect = gutter.getBoundingClientRect();
        const lineRect = line.getBoundingClientRect();
        return [{
          delta: Math.abs(gutterRect.top - lineRect.top),
          overlaps: Math.min(gutterRect.bottom, lineRect.bottom) >
            Math.max(gutterRect.top, lineRect.top),
        }];
      });
      return {
        visibleLines: visible.length,
        visibleGutters: gutters.length,
        maxGutterDelta: Math.max(0, ...gutterGeometry.map(({ delta }) => delta)),
        misalignedGutters: gutterGeometry.filter(({ overlaps }) => !overlaps).length,
        documentScrollLeak:
          (document.scrollingElement?.scrollTop ?? 0) !== 0 ||
          (document.scrollingElement?.scrollLeft ?? 0) !== 0,
        currentLine: getCurrentLine() ?? 0,
        docLines: view.state.doc.lines,
      };
    })`,
  );
}

// The editor legitimately re-measures for a frame or two after a change, so a
// single immediate reading cannot tell "still settling" apart from "broken".
// Poll until each fully visible gutter label overlaps the exact logical line
// named by that label. This catches a one-row shift without relying on a magic
// pixel tolerance that changes with font rasterization and device scale.

async function expectCoherent(
  page: Parameters<typeof expectDesktopShellAnchored>[0],
  context: string,
) {
  const deadline = Date.now() + 5_000;
  let state = await coherence(page);
  while (
    Date.now() < deadline &&
    (state.visibleLines === 0 ||
      state.visibleGutters === 0 ||
      state.misalignedGutters > 0 ||
      state.documentScrollLeak)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    state = await coherence(page);
  }
  expect(state.docLines, `${context}: document lost lines`).toBeGreaterThan(
    LARGE_BOOK_LINE_COUNT - 50,
  );
  expect(
    state.visibleLines,
    `${context}: viewport never painted a line (seed ${SEED})`,
  ).toBeGreaterThan(0);
  expect(
    state.visibleGutters,
    `${context}: viewport never painted a line number (seed ${SEED})`,
  ).toBeGreaterThan(0);
  expect(
    state.misalignedGutters,
    `${context}: ${state.misalignedGutters} line number(s) did not overlap their rows; max top delta ${state.maxGutterDelta}px (seed ${SEED})`,
  ).toBe(0);
  expect(
    state.documentScrollLeak,
    `${context}: the page scrolled instead of the editor (seed ${SEED})`,
  ).toBe(false);
  await expectDesktopShellAnchored(page);
}

async function openLargeBook(
  page: Parameters<typeof openProject>[0],
): Promise<void> {
  await expect(
    page.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible({ timeout: 30_000 });
  const exists = await page.evaluate<boolean>(
    `!!document.querySelector('button[aria-label="Open ${PROJECT}"]')`,
  );
  if (exists) {
    await openProject(page, PROJECT);
    await expect(page.locator(".cm-content")).toBeVisible({ timeout: 30_000 });
    return;
  }
  const fixture = buildLargeLatexBookProject();
  await createBlankProject(page, PROJECT);
  await page.evaluate(
    `Promise.all([
      import("/src/store/compile.ts"),
      import("/src/store/settings.ts"),
    ]).then(([compile, settings]) => {
      // These scenarios measure the editor, not the compiler. Auto-compile
      // would inject unrelated multi-second pauses into every interaction.
      compile.useCompileStore.getState().setAutoCompile(false);
      settings.useSettingsStore.getState().setViewMode("split");
      return true;
    })`,
  );
  for (const [path, content] of Object.entries(fixture.files)) {
    if (path !== "main.tex") await writeProjectText(page, path, content);
  }
  await replaceEditorSource(page, fixture.source);
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 30_000 });
}

async function gotoLine(
  page: Parameters<typeof expectDesktopShellAnchored>[0],
  line: number,
) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ gotoLine }) => {
      gotoLine(${line});
      return true;
    })`,
  );
  await page.evaluate(`(async () => {${FRAME_HELPER}
    await nextFrame();
    await nextFrame();
    return true;
  })()`);
}

test.beforeEach(async ({ tauriPage }) => {
  test.setTimeout(300_000);
  await openLargeBook(tauriPage);
});

test("seeded jumps across the whole document keep the gutter aligned", async ({
  tauriPage,
}) => {
  const lines = seededLines(12);
  console.log(`interaction seed ${SEED}: lines ${lines.join(", ")}`);
  for (const line of lines) {
    await gotoLine(tauriPage, line);
    await expectCoherent(tauriPage, `after jumping to line ${line}`);
  }
});

test("the first and last lines both render without a blank viewport", async ({
  tauriPage,
}) => {
  for (const line of [1, 2, LARGE_BOOK_LINE_COUNT - 1, LARGE_BOOK_LINE_COUNT, 1]) {
    await gotoLine(tauriPage, line);
    await expectCoherent(tauriPage, `at extreme line ${line}`);
  }
});

test("scrolling that never settles still leaves the editor painted", async ({
  tauriPage,
}) => {
  // Deliberately does not wait for the editor to settle between moves: each
  // scroll interrupts the previous render, which is what a user flicking a
  // trackpad actually produces.
  const probe = await tauriPage.evaluate<{ blank: number; steps: number }>(
    `import("/src/components/editor/cm/controller.ts").then(async ({ getEditorView }) => {
      ${FRAME_HELPER}
      const view = getEditorView();
      if (!view) throw new Error("editor is unavailable");
      const span = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
      const ratios = [0, 0.97, 0.03, 0.88, 0.11, 0.76, 0.22, 0.64, 0.35, 0.5];
      let blank = 0;
      let steps = 0;
      for (let round = 0; round < 3; round++) {
        for (const ratio of ratios) {
          view.scrollDOM.scrollTop = span * ratio;
          view.scrollDOM.dispatchEvent(new Event("scroll"));
          await nextFrame();
          steps++;
          const viewport = view.scrollDOM.getBoundingClientRect();
          const painted = Array.from(view.contentDOM.querySelectorAll(".cm-line")).filter(
            (line) => {
              const rect = line.getBoundingClientRect();
              return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
            },
          ).length;
          if (painted === 0) blank++;
        }
      }
      return { blank, steps };
    })`,
  );
  expect(probe.steps).toBe(30);
  expect(probe.blank, "a scroll step left the viewport empty").toBe(0);
  await expectCoherent(tauriPage, "after uninterrupted scrolling");
});

test("an edit made during fast scrolling lands on the intended line", async ({
  tauriPage,
}) => {
  const target = seededLines(1)[0];
  const marker = `INTERACTIONMARKER${SEED}`;
  await tauriPage.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(async ({ getEditorView, gotoLine }) => {
      ${FRAME_HELPER}
      const view = getEditorView();
      if (!view) throw new Error("editor is unavailable");
      const span = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
      // Fling the viewport, then edit before the scroll has settled.
      for (const ratio of [0.9, 0.15, 0.7]) {
        view.scrollDOM.scrollTop = span * ratio;
        view.scrollDOM.dispatchEvent(new Event("scroll"));
      }
      gotoLine(${target});
      const line = view.state.doc.line(${target});
      view.dispatch({
        changes: { from: line.from, insert: ${JSON.stringify(marker)} + " " },
        scrollIntoView: true,
      });
      await nextFrame();
      return true;
    })`,
  );
  const placement = await tauriPage.evaluate<{ line: number; text: string }>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) throw new Error("editor is unavailable");
      const index = view.state.doc.toString().indexOf(${JSON.stringify(marker)});
      if (index < 0) return { line: -1, text: "" };
      const line = view.state.doc.lineAt(index);
      return { line: line.number, text: line.text.slice(0, 60) };
    })`,
  );
  expect(
    placement.line,
    `edit during scrolling landed on line ${placement.line} instead of ${target} (seed ${SEED})`,
  ).toBe(target);
  expect(placement.text).toContain(marker);
  await expectCoherent(tauriPage, "after editing mid-scroll");
});

test("a burst of edits at scattered lines survives undo", async ({
  tauriPage,
}) => {
  const targets = seededLines(6);
  const before = await tauriPage.evaluate<number>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) =>
      getEditorView()?.state.doc.length ?? -1)`,
  );
  // Exercise the app's isolated edit boundary one action at a time. Waiting a
  // frame does not split CodeMirror history groups; raw dispatches here used
  // to let repeated undo walk into the fixture's initial document load.
  for (const target of targets) {
    await tauriPage.evaluate(
      `import("/src/components/editor/cm/controller.ts").then(({ getEditorView, replaceRange }) => {
        const view = getEditorView();
        if (!view) throw new Error("editor is unavailable");
        const line = view.state.doc.line(Math.min(${target}, view.state.doc.lines));
        replaceRange(line.from, line.from, "BURST ");
        return true;
      })`,
    );
  }
  const during = await tauriPage.evaluate<number>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) =>
      getEditorView()?.state.doc.length ?? -1)`,
  );
  expect(during).toBeGreaterThan(before);
  await expectCoherent(tauriPage, "after a burst of edits");

  // Uses the app's own undo entry point rather than CodeMirror's command, so
  // this exercises the path the toolbar and keyboard shortcut actually take.
  const undoLengths: number[] = [];
  for (let i = 0; i < targets.length; i++) {
    undoLengths.push(
      await tauriPage.evaluate<number>(
        `import("/src/components/editor/cm/controller.ts").then(({ editorUndo, getEditorView }) => {
          editorUndo();
          return getEditorView()?.state.doc.length ?? -1;
        })`,
      ),
    );
  }
  expect(undoLengths).toEqual(
    Array.from({ length: targets.length }, (_, index) => during - (index + 1) * 6),
  );
  const after = undoLengths.at(-1) ?? -1;
  expect(after, `undo did not restore the document (seed ${SEED})`).toBe(before);
  await expectCoherent(tauriPage, "after undoing the burst");
});
