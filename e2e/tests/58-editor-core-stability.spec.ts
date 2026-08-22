import { test, expect } from "../fixtures";
import {
  compileAndProbe,
  compileAndWait,
  createBlankProject,
  expectDesktopShellAnchored,
  openRailTab,
  replaceEditorSource,
  setEditorCaretAfter,
  typeInEditorAfter,
  waitLong,
  writeProjectText,
} from "../helpers";
import { buildLargeLatexBookProject } from "../../test/fixtures/editor-support/large-book";

interface EditorGeometry {
  readonly currentLine: number;
  readonly viewportHeight: number;
  readonly visibleLineCount: number;
  readonly numberedGutterCount: number;
  readonly maxLineNumberDelta: number;
  readonly hiddenGutterSpacers: number;
  readonly baseLineHeight: number;
  readonly maxLineHeight: number;
  readonly maxPlainLineResidual: number;
  readonly maxWidgetLineResidual: number;
  readonly maxLineMultiple: number;
  readonly topBlank: number;
  readonly bottomBlank: number;
  readonly blockWidgets: number;
  readonly worstLine: string;
}

interface AuthoringChaosProbe {
  readonly p95: number;
  readonly max: number;
  readonly samples: number;
  readonly blankFrames: number;
  readonly missingSurfaceFrames: number;
  readonly misalignedFrames: number;
  readonly misalignedActions: Readonly<Record<string, number>>;
  readonly maxSettleFrames: number;
  readonly misalignedSamples: ReadonlyArray<{
    readonly action: string;
    readonly line: number;
    readonly delta: number;
    readonly settleFrames: number;
    readonly detail: string;
    readonly heightMismatch: string | null;
  }>;
  readonly maxGutterDelta: number;
  readonly documentScrollLeaks: number;
  readonly sourceRestored: boolean;
  readonly actionCounts: Readonly<Record<string, number>>;
  readonly actionP95: Readonly<Record<string, number>>;
  readonly error?: string;
}

async function goToLine(
  page: Parameters<typeof expectDesktopShellAnchored>[0],
  line: number,
) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ gotoLine }) => {
      gotoLine(${line});
      return true;
    })`,
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
}

// Preview controls sit in the toolbar until it narrows, then move into the
// "More preview controls" overflow menu. The bridge's synthetic click is
// sometimes discarded before React commits, which left the outline panel
// `inert` and made this spec flaky. Toggles expose aria-pressed, so retry until
// it actually flips, measured against a baseline fixed the first time the
// control is present so a late commit cannot be toggled straight back off.
async function activatePreviewControl(
  page: Parameters<typeof expectDesktopShellAnchored>[0],
  label: string,
) {
  const selector = JSON.stringify(`[aria-label=${JSON.stringify(label)}]`);
  const pressedExpression = `(() => {
    const control = document.querySelector(${selector});
    return control ? (control.getAttribute('aria-pressed') ?? 'none') : 'absent';
  })()`;
  const clickDirectExpression = `(() => {
    const control = document.querySelector(${selector});
    if (!control || control.getClientRects().length === 0) return "gone";
    control.click();
    return "clicked";
  })()`;
  // Reveal a control that the narrow toolbar moved into the overflow menu.
  const revealExpression = `(() => {
    const trigger = document.querySelector('[aria-label="More preview controls"]');
    if (!trigger) return "missing";
    return trigger.getAttribute('aria-expanded') === 'true' ? "open" : "closed";
  })()`;
  const deadline = Date.now() + 15_000;
  // Captured the first time the control is actually present. Comparing against
  // this fixed value (never against the latest reading) is what stops a click
  // that committed late from being toggled straight back off by a retry.
  let baseline: string | null = null;
  let last = "";
  for (;;) {
    const current = await page.evaluate<string>(pressedExpression);
    if (baseline !== null && current !== "absent" && current !== baseline) return;
    if (current === "absent") {
      last = await page.evaluate<string>(revealExpression);
      if (last === "closed") {
        // Radix DropdownMenu opens from pointer input. HTMLElement.click()
        // skips that path, which made the overflow-only CI layout loop forever
        // even though the row was correctly rendered and labelled. Exercise
        // the same pointer sequence a user does through the bridge instead.
        await page.click('[aria-label="More preview controls"]');
        last = "opening";
      }
    } else {
      baseline ??= current;
      last = await page.evaluate<string>(clickDirectExpression);
      // No aria-pressed means an action, not a toggle: there is no committed
      // state to wait for, so one delivered click is the whole contract.
      if (baseline === "none" && last === "clicked") return;
      if (last === "clicked") {
        try {
          await page.waitForFunction(
            `${pressedExpression} !== ${JSON.stringify(baseline)}`,
            2_000,
          );
          return;
        } catch {
          // Discarded before React committed; the loop re-checks and retries.
        }
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`preview control ${label} never activated (${last})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function editorGeometry(
  page: Parameters<typeof expectDesktopShellAnchored>[0],
): Promise<EditorGeometry> {
  return page.evaluate<EditorGeometry>(
    `import("/src/components/editor/cm/controller.ts").then(
      ({ getCurrentLine, getEditorView }) => {
        const view = getEditorView();
        if (!view) throw new Error("editor is unavailable");
        const scroller = view.scrollDOM;
        const viewport = scroller.getBoundingClientRect();
        const lines = Array.from(
          view.contentDOM.querySelectorAll(".cm-line"),
        ).filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
        });
        const allNumberedGutters = Array.from(
          view.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
        ).filter((element) => /^\\d+$/.test(element.textContent?.trim() ?? ""));
        const gutters = allNumberedGutters.filter(
          (element) =>
            /^\\d+$/.test(element.textContent?.trim() ?? "") &&
            // The line-number gutter ends with a hidden spacer element that
            // carries the highest line number purely to reserve width. It is a
            // .cm-gutterElement with numeric text, so it matches the filter, but
            // it is aligned to nothing - its rect sits at the gutter's top. Left
            // in, it reports the top row's scroll offset as gutter drift.
            element.style.visibility !== "hidden",
        );
        const deltas = gutters.flatMap((gutter) => {
          const lineNumber = Number(gutter.textContent?.trim());
          if (
            !Number.isInteger(lineNumber) ||
            lineNumber < 1 ||
            lineNumber > view.state.doc.lines
          ) {
            return [];
          }
          const position = view.state.doc.line(lineNumber).from;
          // A line start is also the previous line's end. Bias forward so the
          // geometry probe resolves the numbered line itself.
          const domPosition = view.domAtPos(position, 1);
          const element =
            domPosition.node.nodeType === Node.ELEMENT_NODE
              ? domPosition.node
              : domPosition.node.parentElement;
          const line = element?.closest?.(".cm-line");
          if (!line) return [];
          return [
            Math.abs(
              gutter.getBoundingClientRect().top -
                line.getBoundingClientRect().top,
            ),
          ];
        });
        // Derive the base visual row from the editor's own measured metric.
        // Using the shortest visible line aliases to two (or more) rows when
        // the whole viewport is soft-wrapped prose, which reports a residual
        // of exactly one row for any odd-row line and fails spuriously on
        // narrow CI windows.
        const base = view.defaultLineHeight;
        const stats = lines.map((line) => {
          const height = line.getBoundingClientRect().height;
          const rows = Math.max(1, Math.round(height / base));
          return {
            height,
            rows,
            residual: Math.abs(height - rows * base),
            widget: !!line.querySelector(".math-preview"),
            text: (line.textContent ?? "").slice(0, 60),
          };
        });
        const heights = stats.map((entry) => entry.height);
        const plain = stats.filter((entry) => !entry.widget);
        const widget = stats.filter((entry) => entry.widget);
        const worst = stats.reduce(
          (current, entry) =>
            entry.residual > (current?.residual ?? -1) ? entry : current,
          null,
        );
        const first = lines[0]?.getBoundingClientRect();
        const last = lines.at(-1)?.getBoundingClientRect();
        return {
          currentLine: getCurrentLine() ?? 0,
          viewportHeight: viewport.height,
          visibleLineCount: lines.length,
          numberedGutterCount: gutters.length,
          maxLineNumberDelta: Math.max(0, ...deltas),
          // Expected to be exactly 1: CodeMirror's width-reserving spacer. If
          // this ever reads 0 the filter has stopped matching it and the probe
          // is measuring a phantom row again.
          hiddenGutterSpacers: allNumberedGutters.length - gutters.length,
          baseLineHeight: base,
          maxLineHeight: Math.max(0, ...heights),
          maxPlainLineResidual: Math.max(
            0,
            ...plain.map((entry) => entry.residual),
          ),
          maxWidgetLineResidual: Math.max(
            0,
            ...widget.map((entry) => entry.residual),
          ),
          maxLineMultiple: Math.max(0, ...stats.map((entry) => entry.rows)),
          topBlank: first ? Math.max(0, first.top - viewport.top) : viewport.height,
          bottomBlank: last ? Math.max(0, viewport.bottom - last.bottom) : viewport.height,
          blockWidgets: view.dom.querySelectorAll(".cm-blockWidget").length,
          worstLine: JSON.stringify(worst),
        };
      },
    )`,
  );
}

async function expectStableGeometry(
  page: Parameters<typeof expectDesktopShellAnchored>[0],
  line: number,
) {
  await goToLine(page, line);
  // goToLine's fixed pause is not always enough on a loaded machine: the editor
  // re-measures the gutter for a few more frames, and reading once right after
  // it caught a transient 15px drift against the 1.5px bound below. Poll for the
  // settled layout so the strict bound keeps its meaning instead of being
  // loosened to absorb a delay that always resolves.
  let geometry = await editorGeometry(page);
  const settleDeadline = Date.now() + 5_000;
  while (geometry.maxLineNumberDelta > 1.5 && Date.now() < settleDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    geometry = await editorGeometry(page);
  }
  expect(geometry.currentLine).toBe(line);
  // A fixed source-line count is invalid in split view: ordinary prose can
  // wrap to multiple visual rows as the native window width changes. Require
  // enough lines to fill the measured viewport at the tallest legitimate row
  // height, while the blank-space and row-multiple checks below remain the
  // authoritative guards against the historical giant-spacer regression.
  const minimumVisibleLines = Math.max(
    4,
    Math.floor(
      geometry.viewportHeight /
        Math.max(geometry.maxLineHeight, geometry.baseLineHeight),
    ) - 2,
  );
  expect(geometry.visibleLineCount).toBeGreaterThanOrEqual(
    minimumVisibleLines,
  );
  expect(geometry.numberedGutterCount).toBeGreaterThanOrEqual(
    geometry.visibleLineCount,
  );
  // Exactly one hidden spacer must have been excluded. Counting it as a real
  // row is what made this probe report a phantom sub-row offset on loaded CI
  // machines; if CodeMirror ever stops emitting it, fail here with a clear
  // reason rather than silently drifting back to measuring nothing.
  expect(geometry.hiddenGutterSpacers).toBe(1);
  expect(geometry.maxLineNumberDelta).toBeLessThanOrEqual(1.5);
  expect(geometry.baseLineHeight).toBeGreaterThan(10);
  // Split view intentionally wraps realistic prose. Wrapped rows must remain
  // stable multiples of the editor's own base row; the historical regression
  // produced arbitrary hundreds-of-pixels spacers. Plain text rows get a
  // tight budget, while lines hosting an inline KaTeX preview may grow by
  // the preview's natural height (padding, border, tall glyphs) without
  // that growth being a spacer regression.
  // A coarse sanity bound, not the structural guard: how many rows a line
  // wraps to is a property of the pane width, so this number has to clear the
  // narrowest supported layout. Measured on the same fixture line, the one
  // carrying an inline KaTeX preview: 6 rows in a default-width split, 8 at
  // 1024x700, 9 on WebView2, which lays text out wider than WebKit at the same
  // window size. The regression this exists to catch produced spacers of
  // *hundreds* of pixels - 15+ rows at this base height - so 12 still fails on
  // it while leaving room for legitimate wrapping.
  //
  // The real anti-spacer guard is the residual assertion below: it proves each
  // line is an exact multiple of the editor's own base row, which a phantom
  // spacer never is.
  expect(geometry.maxLineMultiple, geometry.worstLine).toBeLessThanOrEqual(12);
  expect(
    geometry.maxPlainLineResidual,
    geometry.worstLine,
  ).toBeLessThanOrEqual(8);
  expect(
    geometry.maxWidgetLineResidual,
    geometry.worstLine,
  ).toBeLessThanOrEqual(geometry.baseLineHeight * 1.5);
  expect(geometry.topBlank).toBeLessThanOrEqual(
    geometry.maxLineHeight * 2,
  );
  expect(geometry.bottomBlank).toBeLessThanOrEqual(
    geometry.maxLineHeight * 2,
  );
  expect(geometry.blockWidgets).toBe(0);
  await expectDesktopShellAnchored(page);
}

async function expectFullAuthoringWorkspace(
  page: Parameters<typeof expectDesktopShellAnchored>[0],
) {
  const state = await page.evaluate<{
    viewMode: string;
    sourceTree: boolean;
    editor: boolean;
    preview: boolean;
    proofingPhase: string;
    proofingPath: string | null;
  }>(
    `Promise.all([
      import("/src/store/settings.ts"),
      import("/src/components/editor/cm/controller.ts"),
      import("/src/store/proofreading.ts"),
    ]).then(([settings, controller, proofreading]) => {
      const view = controller.getEditorView();
      const visible = (selector) => {
        const element = document.querySelector(selector);
        return !!element && element.getClientRects().length > 0;
      };
      return {
        viewMode: settings.useSettingsStore.getState().viewMode,
        sourceTree: visible('[role="tree"]'),
        editor: !!view && visible(".cm-editor"),
        preview: visible(".pdf-canvas"),
        proofingPhase:
          proofreading.useProofreadingStore.getState().source.phase,
        proofingPath:
          proofreading.useProofreadingStore.getState().source.identity?.path ??
          null,
      };
    })`,
  );
  expect(state.viewMode).toBe("split");
  expect(state.sourceTree).toBe(true);
  expect(state.editor).toBe(true);
  expect(state.preview).toBe(true);
  expect(["loading", "ready", "partial"]).toContain(state.proofingPhase);
  expect(state.proofingPath).toBe("main.tex");
  await expectDesktopShellAnchored(page);
}

async function runAuthoringChaos(
  page: Parameters<typeof expectDesktopShellAnchored>[0],
): Promise<AuthoringChaosProbe> {
  await page.evaluate(
    `(() => {
      window.__e2eBookAuthoringChaos = null;
      (async () => {
        const controller = await import(
          "/src/components/editor/cm/controller.ts"
        );
        const view = controller.getEditorView();
        if (!view) throw new Error("editor is unavailable");
        const original = view.state.doc.toString();
        const durations = [];
        const durationsByAction = {};
        const actionCounts = {};
        let blankFrames = 0;
        let missingSurfaceFrames = 0;
        let misalignedFrames = 0;
        let maxSettleFrames = 0;
        const misalignedActions = {};
        const misalignedSamples = [];
        let maxGutterDelta = 0;
        let documentScrollLeaks = 0;
        const targets = [
          240, 690, 1_080, 1_530, 1_970, 2_420,
          2_860, 3_310, 3_760, 4_190, 4_640, 5_120,
        ];
        // requestAnimationFrame stops firing altogether in an occluded or
        // backgrounded WebView. This probe awaits a frame hundreds of times, so
        // a bare rAF turns a window that lost focus into a silent hang that the
        // outer wait can only report as an unexplained timeout. Racing a timer
        // keeps the settle loops honest while guaranteeing they terminate.
        const frame = () =>
          new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              resolve(undefined);
            };
            requestAnimationFrame(finish);
            setTimeout(finish, 100);
          });
        const pause = (ms) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const gutterDelta = () => {
          const gutters = Array.from(
            view.dom.querySelectorAll(
              ".cm-lineNumbers .cm-gutterElement",
            ),
          ).filter(
            (element) =>
              /^\\d+$/.test(element.textContent?.trim() ?? "") &&
              // Same hidden width-reserving spacer as the geometry probe above.
              element.style.visibility !== "hidden",
          );
          const deltas = gutters.flatMap((gutter) => {
            const lineNumber = Number(gutter.textContent?.trim());
            if (
              !Number.isInteger(lineNumber) ||
              lineNumber < 1 ||
              lineNumber > view.state.doc.lines
            ) {
              return [];
            }
            const position = view.state.doc.line(lineNumber).from;
            // A line start is also the previous line's end. Bias forward so
            // this gutter is compared with its own row, not the prior row.
            const domPosition = view.domAtPos(position, 1);
            const element =
              domPosition.node.nodeType === Node.ELEMENT_NODE
                ? domPosition.node
                : domPosition.node.parentElement;
            const line = element?.closest?.(".cm-line");
            if (!line) return [];
            const gutterRect = gutter.getBoundingClientRect();
            const lineRect = line.getBoundingClientRect();
            return [
              {
                lineNumber,
                delta: Math.abs(gutterRect.top - lineRect.top),
                // Captured so a persistent offset can be identified from a CI
                // log: a constant delta points at a fixed-size element, not a
                // timing race, and the resolved line's own text says whether
                // domAtPos landed on the row the gutter is numbering.
                detail: {
                  gutterTop: Math.round(gutterRect.top * 10) / 10,
                  lineTop: Math.round(lineRect.top * 10) / 10,
                  signed: Math.round((gutterRect.top - lineRect.top) * 10) / 10,
                  gutterHeight: Math.round(gutterRect.height * 10) / 10,
                  lineHeight: Math.round(lineRect.height * 10) / 10,
                  widget: !!line.querySelector(".math-preview"),
                  blockWidget: !!line.querySelector(".cm-widgetBuffer, .cm-blockWidget"),
                  resolved: (line.textContent ?? "").slice(0, 40),
                  expected: view.state.doc.line(lineNumber).text.slice(0, 40),
                  docLines: view.state.doc.lines,
                },
              },
            ];
          });
          // A gutter element sitting above its own correctly-resolved line means
          // the columns disagree about some earlier line's height: CodeMirror
          // sizes each gutter element from its heightmap, so a line whose real
          // rendered height outgrew the recorded one shifts everything below by
          // the difference. Find the first row where the two columns diverge -
          // that line, not the sampled one, is the culprit.
          let heightMismatch = null;
          for (const entry of deltas) {
            const d = entry.detail;
            if (Math.abs(d.gutterHeight - d.lineHeight) > 1) {
              heightMismatch = {
                lineNumber: entry.lineNumber,
                gutterHeight: d.gutterHeight,
                lineHeight: d.lineHeight,
                widget: d.widget,
                text: d.expected,
              };
              break;
            }
          }
          let worst = 0;
          let worstLineNumber = 0;
          let worstDetail = null;
          for (const entry of deltas) {
            if (entry.delta > worst) {
              worst = entry.delta;
              worstLineNumber = entry.lineNumber;
              worstDetail = entry.detail;
            }
          }
          return {
            gutterCount: gutters.length,
            maxDelta: worst,
            worstLineNumber,
            worstDetail,
            heightMismatch: heightMismatch ? JSON.stringify(heightMismatch) : null,
          };
        };
        let geometrySample = null;
        const inspect = async (actionName) => {
          const scroller = view.scrollDOM;
          const viewport = scroller.getBoundingClientRect();
          const visibleLines = Array.from(
            view.contentDOM.querySelectorAll(".cm-line"),
          ).filter((line) => {
            const rect = line.getBoundingClientRect();
            return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
          });
          let { gutterCount, maxDelta, worstLineNumber, worstDetail, heightMismatch } =
            gutterDelta();
          let settleFrames = 0;
          // Debounced decoration dispatches (math previews, lint sets) can land
          // between an edit and this probe, leaving the gutter spacer one
          // measure pass behind its line. Only misalignment that SURVIVES
          // settling is the persistent drift this probe exists to catch, so
          // wait for the measurement to stop changing rather than for a fixed
          // number of frames - two is a count tuned on a fast machine, and a
          // loaded CI runner needs more.
          while (maxDelta > 1.5 && settleFrames < 24) {
            await frame();
            settleFrames++;
            ({ gutterCount, maxDelta, worstLineNumber, worstDetail, heightMismatch } =
              gutterDelta());
          }
          maxGutterDelta = Math.max(maxGutterDelta, maxDelta);
          maxSettleFrames = Math.max(maxSettleFrames, settleFrames);
          if (!geometrySample && worstDetail) geometrySample = JSON.stringify(worstDetail);
          if (visibleLines.length < 5 || gutterCount < 5) blankFrames++;
          if (maxDelta > 1.5) {
            misalignedFrames++;
            misalignedActions[actionName] =
              (misalignedActions[actionName] ?? 0) + 1;
            // Persisted past every frame we were willing to wait: record what
            // actually moved so a CI-only failure is diagnosable from its log.
            if (misalignedSamples.length < 5) {
              misalignedSamples.push({
                action: actionName,
                line: worstLineNumber,
                delta: Math.round(maxDelta * 100) / 100,
                settleFrames,
                // A string, not an object: this lands nested inside the probe
                // result, and console.log's default inspect depth prints a
                // deeper object as "[Object]" - which is exactly what a CI log
                // showed the first time round.
                detail: JSON.stringify(worstDetail),
                heightMismatch,
              });
            }
          }
          const tree = document.querySelector('[role="tree"]');
          const pdf = document.querySelector(".pdf-canvas");
          if (
            !tree ||
            !pdf ||
            tree.getClientRects().length === 0 ||
            pdf.getClientRects().length === 0
          ) {
            missingSurfaceFrames++;
          }
          if (
            (document.scrollingElement?.scrollTop ?? 0) !== 0 ||
            (document.scrollingElement?.scrollLeft ?? 0) !== 0
          ) {
            documentScrollLeaks++;
          }
        };
        const measured = async (name, action, delay = 0) => {
          const started = performance.now();
          action();
          if (delay > 0) await pause(delay);
          await frame();
          await frame();
          durations.push(performance.now() - started);
          (durationsByAction[name] ??= []).push(
            performance.now() - started,
          );
          actionCounts[name] = (actionCounts[name] ?? 0) + 1;
          await inspect(name);
        };

        for (let index = 0; index < targets.length; index++) {
          let lineNumber = targets[index];
          while (
            lineNumber < view.state.doc.lines &&
            !view.state.doc.line(lineNumber).text.includes("; case ")
          ) {
            lineNumber++;
          }
          const line = view.state.doc.line(lineNumber);
          const insertion = line.from + Math.min(48, line.length);
          await measured("navigate", () => {
            // Exercise the same editor-local reveal path used by structure,
            // reference, search, and SyncTeX navigation. It intentionally
            // avoids CodeMirror's ancestor-scrolling effect in the desktop
            // split-pane shell.
            controller.gotoLine(lineNumber);
            view.dispatch({
              selection: { anchor: insertion },
            });
          });

          const token = " author-note-" + String(index + 1).padStart(2, "0");
          for (const character of token) {
            await measured(
              "type",
              () => {
                const head = view.state.selection.main.head;
                view.dispatch({
                  changes: { from: head, insert: character },
                  selection: { anchor: head + character.length },
                  userEvent: "input.type",
                });
              },
              18,
            );
          }
          const afterTyping = view.state.doc.toString();
          const pasted =
            "\\n% pasted editorial observation " +
            String(index + 1).padStart(2, "0") +
            "\\nA pasted field note preserves provenance for revision " +
            String(index + 1).padStart(2, "0") +
            ".\\n";
          await measured("paste", () => {
            const head = view.state.selection.main.head;
            view.dispatch({
              changes: { from: head, insert: pasted },
              selection: { anchor: head + pasted.length },
              userEvent: "input.paste",
            });
          });
          const afterPaste = view.state.doc.toString();

          await measured("undo", () => controller.editorUndo());
          if (view.state.doc.toString() !== afterTyping) {
            throw new Error("paste undo changed more than the paste");
          }
          await measured("redo", () => controller.editorRedo());
          if (view.state.doc.toString() !== afterPaste) {
            throw new Error("paste redo did not restore the paste");
          }
          await measured("undo", () => controller.editorUndo());
          if (view.state.doc.toString() !== afterTyping) {
            throw new Error("second paste undo was not exact");
          }
          await measured("delete", () => {
            view.dispatch({
              changes: {
                from: insertion,
                to: insertion + token.length,
                insert: "",
              },
              selection: { anchor: insertion },
              userEvent: "delete.backward",
            });
          });
          if (view.state.doc.toString() !== original) {
            throw new Error(
              "typing/paste cycle did not restore the original source",
            );
          }
          if (index % 3 === 2) {
            await pause(500);
            await frame();
            await inspect("settled");
          }
        }

        durations.sort((left, right) => left - right);
        const actionP95 = Object.fromEntries(
          Object.entries(durationsByAction).map(([name, values]) => {
            values.sort((left, right) => left - right);
            return [
              name,
              values[Math.ceil(values.length * 0.95) - 1] ?? 0,
            ];
          }),
        );
        window.__e2eBookAuthoringChaos = {
          p95:
            durations[Math.ceil(durations.length * 0.95) - 1] ?? 0,
          max: Math.max(0, ...durations),
          samples: durations.length,
          blankFrames,
          missingSurfaceFrames,
          misalignedFrames,
          misalignedActions,
          maxSettleFrames,
          geometrySample,
          misalignedSamples,
          maxGutterDelta,
          documentScrollLeaks,
          sourceRestored: view.state.doc.toString() === original,
          actionCounts,
          actionP95,
        };
      })().catch((error) => {
        window.__e2eBookAuthoringChaos = { error: String(error) };
      });
      return true;
    })()`,
  );
  await waitLong(
    page,
    `window.__e2eBookAuthoringChaos !== null`,
    120_000,
  );
  return page.evaluate<AuthoringChaosProbe>(
    `window.__e2eBookAuthoringChaos`,
  );
}

test("a realistic 6,200-line book keeps the full authoring workspace stable under chaos", async ({
  tauriPage,
}) => {
  test.setTimeout(600_000);
  const fixture = buildLargeLatexBookProject();
  await createBlankProject(
    tauriPage,
    `E2E Large Book ${Date.now().toString(36)}`,
  );
  await tauriPage.evaluate(
    `Promise.all([
      import("/src/store/compile.ts"),
      import("/src/store/settings.ts"),
    ]).then(([compile, settings]) => {
      compile.useCompileStore.getState().setAutoCompile(false);
      settings.useSettingsStore.getState().setViewMode("split");
      settings.useSettingsStore.getState().setEditorAutocomplete(true);
      settings.useSettingsStore.getState().setHarper(true);
      if (!settings.useSettingsStore.getState().spellcheck) {
        settings.useSettingsStore.getState().toggleSpellcheck();
      }
      return true;
    })`,
  );
  for (const [path, content] of Object.entries(fixture.files)) {
    if (path !== "main.tex") {
      await writeProjectText(tauriPage, path, content);
    }
  }
  await replaceEditorSource(tauriPage, fixture.source);
  await openRailTab(tauriPage, "Source Tree");
  await expect(tauriPage.getByText("main.tex", { exact: true })).toBeVisible();
  await expect(
    tauriPage.getByText("frontmatter", { exact: true }),
  ).toBeVisible();

  await compileAndWait(tauriPage, 300_000);
  await expect(tauriPage.locator(".pdf-canvas").first()).toBeVisible({
    timeout: 60_000,
  });
  await waitLong(
    tauriPage,
    `Number(
      document.querySelector('[data-testid="pdf-renderer"]')
        ?.getAttribute("data-pdf-page-count") ?? "0"
    ) > 0`,
    60_000,
  );
  const renderedPageCount = await tauriPage.evaluate<number>(
    `Number(
      document.querySelector('[data-testid="pdf-renderer"]')
        ?.getAttribute("data-pdf-page-count") ?? "0"
    )`,
  );
  expect(renderedPageCount).toBeGreaterThan(40);
  await waitLong(
    tauriPage,
    `Array.from(document.querySelectorAll(".textLayer span")).some(
      (element) =>
        element.textContent?.includes(
          "Evidence, Models, and Reliable Systems",
        ),
    )`,
    60_000,
  );

  await waitLong(
    tauriPage,
    `import("/src/store/project-index.ts").then(({ useIndexStore }) => {
      const state = useIndexStore.getState().intelligenceState;
      return state.status === "success"
        && state.data?.stats.characterCount >= ${fixture.characterCount};
    })`,
    60_000,
  );
  await waitLong(
    tauriPage,
    `Promise.all([
      import("/src/store/proofreading.ts"),
      import("/src/store/files.ts"),
    ]).then(([proofreading, files]) => {
      const state = proofreading.useProofreadingStore.getState();
      const source = state.source;
      const diagnosticIndex = source.diagnostics.findIndex(
        (diagnostic) =>
          diagnostic.word.toLowerCase() === "qwertzuiopz",
      );
      if (
        (source.phase !== "ready" && source.phase !== "partial") ||
        source.identity?.projectId !== files.useFilesStore.getState().projectId ||
        source.identity?.path !== "main.tex" ||
        diagnosticIndex < 0
      ) {
        return false;
      }
      window.__e2eProofreadingTargetOffset =
        source.diagnostics[diagnosticIndex].from;
      window.dispatchEvent(
        new CustomEvent("oleafly:proofreading-presentation-changed", {
          detail: { surface: "source", path: "main.tex" },
        }),
      );
      return true;
    })`,
    90_000,
  );
  const proofreadingTargetOffset = await tauriPage.evaluate<number>(
    `window.__e2eProofreadingTargetOffset`,
  );
  expect(proofreadingTargetOffset).toBeGreaterThanOrEqual(0);
  const proofreadingTargetLine =
    fixture.source.slice(0, proofreadingTargetOffset).split("\n").length;
  await goToLine(tauriPage, proofreadingTargetLine);
  // The Tauri bridge caps a single wait_for_function command at 30 seconds
  // even when a longer timeout is supplied. Poll through the shared helper so
  // a loaded Linux runner can finish the book-scale proofreading pass.
  await waitLong(
    tauriPage,
    `window.__e2eHasProofreadingDiagnosticAt?.(${proofreadingTargetOffset}) === true`,
    90_000,
  );
  await expect(
    tauriPage.locator(".cm-lintRange").first(),
  ).toBeVisible({ timeout: 30_000 });
  await expectFullAuthoringWorkspace(tauriPage);

  for (const line of [1_100, 3_100, 5_100]) {
    await expectStableGeometry(tauriPage, line);
  }

  await tauriPage.evaluate(
    `(() => {
      window.__e2eLargeEditorScrollProbe = null;
      (async () => {
        const { getEditorView } = await import(
          "/src/components/editor/cm/controller.ts"
        );
        const view = getEditorView();
        if (!view) throw new Error("editor is unavailable");
        // An occluded or backgrounded WebView stops firing requestAnimationFrame
        // entirely, which used to hang this probe until the outer waitLong gave
        // up with no diagnosis. Race every frame wait against a timer so the
        // probe always finishes and reports real numbers instead of vanishing.
        const nextFrame = () =>
          new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              resolve(undefined);
            };
            requestAnimationFrame(finish);
            setTimeout(finish, 100);
          });
        const durations = [];
        let blankFrames = 0;
        let missingSurfaceFrames = 0;
        let documentScrollLeaks = 0;
        const ratios = [0.08, 0.91, 0.27, 0.73, 0.42, 0.58, 0.15, 0.85];
        for (let round = 0; round < 4; round++) {
          for (const ratio of ratios) {
            const started = performance.now();
            view.scrollDOM.scrollTop =
              (view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight) * ratio;
            view.scrollDOM.dispatchEvent(new Event("scroll"));
            await nextFrame();
            await nextFrame();
            durations.push(performance.now() - started);
            const viewport = view.scrollDOM.getBoundingClientRect();
            const visibleLines = Array.from(
              view.contentDOM.querySelectorAll(".cm-line"),
            ).filter((line) => {
              const rect = line.getBoundingClientRect();
              return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
            });
            if (visibleLines.length < 5) blankFrames++;
            const tree = document.querySelector('[role="tree"]');
            const canvas = document.querySelector(".pdf-canvas");
            if (
              !tree ||
              !canvas ||
              tree.getClientRects().length === 0 ||
              canvas.getClientRects().length === 0
            ) {
              missingSurfaceFrames++;
            }
            if (
              (document.scrollingElement?.scrollTop ?? 0) !== 0 ||
              (document.scrollingElement?.scrollLeft ?? 0) !== 0
            ) {
              documentScrollLeaks++;
            }
          }
        }
        durations.sort((left, right) => left - right);
        const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? 0;
        window.__e2eLargeEditorScrollProbe = {
          p95,
          max: Math.max(...durations),
          blankFrames,
          missingSurfaceFrames,
          documentScrollLeaks,
        };
      })().catch((error) => {
        window.__e2eLargeEditorScrollProbe = { error: String(error) };
      });
      return true;
    })()`,
  );
  await waitLong(
    tauriPage,
    `window.__e2eLargeEditorScrollProbe !== null`,
    30_000,
  );
  const scrollProbe = await tauriPage.evaluate<{
    p95?: number;
    max?: number;
    blankFrames?: number;
    missingSurfaceFrames?: number;
    documentScrollLeaks?: number;
    error?: string;
  }>(`window.__e2eLargeEditorScrollProbe`);
  expect(scrollProbe.error).toBeUndefined();
  // This runner uses an unoptimized Rust/JS dev build on a shared CI machine,
  // so these ceilings catch a native WebView hang, not ordinary slowness: a
  // single GC pause or noisy neighbour legitimately pushes one sample past
  // half a second. The deterministic production-path p95 budgets are enforced
  // separately by test:editor:performance.
  expect(scrollProbe.p95).toBeLessThanOrEqual(1_500);
  expect(scrollProbe.blankFrames).toBe(0);
  expect(scrollProbe.missingSurfaceFrames).toBe(0);
  expect(scrollProbe.documentScrollLeaks).toBe(0);

  const chaos = await runAuthoringChaos(tauriPage);
  console.info("[book-authoring-chaos]", chaos);
  expect(chaos.error).toBeUndefined();
  expect(chaos.samples).toBeGreaterThan(240);
  expect(chaos.p95).toBeLessThanOrEqual(1_500);
  expect(chaos.max).toBeLessThanOrEqual(3_000);
  expect(chaos.blankFrames).toBe(0);
  expect(chaos.missingSurfaceFrames).toBe(0);
  expect(chaos.misalignedFrames).toBe(0);
  expect(chaos.documentScrollLeaks).toBe(0);
  expect(chaos.sourceRestored).toBe(true);
  expect(chaos.actionCounts.type).toBeGreaterThan(150);
  expect(chaos.actionCounts.paste).toBe(12);
  expect(chaos.actionCounts.undo).toBe(24);
  expect(chaos.actionCounts.redo).toBe(12);
  for (const action of [
    "navigate",
    "type",
    "paste",
    "undo",
    "redo",
    "delete",
  ]) {
    expect(chaos.actionP95[action]).toBeLessThanOrEqual(1_500);
  }
  await expect(tauriPage.getByTestId("preview-stale-badge")).toBeHidden({
    timeout: 30_000,
  });
  await expectFullAuthoringWorkspace(tauriPage);

  await goToLine(tauriPage, 3_165);
  const beforeTyping = await tauriPage.evaluate<{
    top: number;
    scrollTop: number;
  }>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) throw new Error("editor is unavailable");
      const position = view.state.selection.main.head;
      return {
        top: view.coordsAtPos(position)?.top ?? -1,
        scrollTop: view.scrollDOM.scrollTop,
      };
    })`,
  );
  for (const character of [" ", "\\", "t", "e", "x"]) {
    await tauriPage.evaluate(
      `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
        const view = getEditorView();
        if (!view) return false;
        const position = view.state.selection.main.head;
        view.dispatch({
          changes: { from: position, insert: ${JSON.stringify(character)} },
          selection: { anchor: position + ${character.length} },
          userEvent: "input.type",
        });
        return true;
      })`,
    );
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll(".cm-tooltip-autocomplete li"))
      .some((item) => item.textContent?.includes("\\\\textbf"))`,
    10_000,
  );
  const afterTyping = await tauriPage.evaluate<{
    top: number;
    scrollTop: number;
    lineHeight: number;
  }>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) throw new Error("editor is unavailable");
      const position = view.state.selection.main.head;
      return {
        top: view.coordsAtPos(position)?.top ?? -1,
        scrollTop: view.scrollDOM.scrollTop,
        lineHeight: view.defaultLineHeight,
      };
    })`,
  );
  // The invariant is that the text under the cursor does not jump on screen.
  expect(Math.abs(afterTyping.top - beforeTyping.top)).toBeLessThanOrEqual(3);
  // scrollTop is the mechanism, not the invariant, and the two cannot both
  // hold still once anything reflows: keeping the cursor at a fixed screen
  // position while the content under it grows *requires* scrolling by the
  // amount it grew. Typing here also opens an autocomplete tooltip, which the
  // editor legitimately scrolls to keep in view. The observed movement on CI
  // was 11px against a 3px bound; the exact cause (a wrap, or scrolling the
  // tooltip into view) was not pinned down, so bound it rather than explain
  // it: one visual line of movement is reflow, more than that is a jump. The
  // bound is measured from the editor instead of hardcoded so it tracks the
  // font settings.
  expect(
    Math.abs(afterTyping.scrollTop - beforeTyping.scrollTop),
  ).toBeLessThanOrEqual(afterTyping.lineHeight + 3);
  await tauriPage.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return false;
      const head = view.state.selection.main.head;
      view.dispatch({
        changes: { from: head - 5, to: head, insert: "" },
        selection: { anchor: head - 5 },
        userEvent: "delete.backward",
      });
      return true;
    })`,
  );
  await waitLong(
    tauriPage,
    `import("/src/components/editor/cm/controller.ts").then(
      ({ getEditorView }) =>
        getEditorView()?.state.doc.length === ${fixture.characterCount},
    )`,
    30_000,
  );
  await expectStableGeometry(tauriPage, 3_165);

  const beforeRecompile = await tauriPage.evaluate<number>(
    `import("/src/store/compile.ts").then(({ useCompileStore }) =>
      useCompileStore.getState().lastCompileCheckpoint?.outputRevision ?? -1,
    )`,
  );
  await tauriPage.click('[data-testid="compile-button"]');
  for (const line of [4_700, 420, 3_480]) {
    await expectStableGeometry(tauriPage, line);
  }
  await waitLong(
    tauriPage,
    `import("/src/store/compile.ts").then(({ useCompileStore }) => {
      const state = useCompileStore.getState();
      return state.status === "success"
        && (state.lastCompileCheckpoint?.outputRevision ?? -1) > ${beforeRecompile};
    })`,
    180_000,
  );
  await expectFullAuthoringWorkspace(tauriPage);
});

test("all core intelligence surfaces agree on one real project revision", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  const name = `E2E Editor Core ${Date.now().toString(36)}`;
  await createBlankProject(tauriPage, name);
  await tauriPage.evaluate(
    `Promise.all([
      import("/src/store/compile.ts"),
      import("/src/store/settings.ts"),
    ]).then(([compile, settings]) => {
      compile.useCompileStore.getState().setAutoCompile(false);
      settings.useSettingsStore.getState().setEditorAutocomplete(true);
      return true;
    })`,
  );
  await writeProjectText(
    tauriPage,
    "chapter.tex",
    String.raw`\subsection{Child result}\label{sec:child}
\begin{equation}\label{eq:core}
x + y = z
\end{equation}
`,
  );
  await writeProjectText(
    tauriPage,
    "refs.bib",
    `@article{edge-source,
  author = {Ada Author},
  title = {Editor Intelligence at Scale},
  year = {2026}
}
`,
  );
  const source = String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage{hyperref}
\begin{document}
\section{Core section}\label{sec:core}
\input{chapter}
The the result contains qwertzuiopz for proofreading.
Inline math stays live: $a^2+b^2=c^2$.
See Section~\ref{sec:child} and Equation~\eqref{eq:core}.
Prior work \cite{edge-source} establishes the method.
CompletionAnchor
\newpage
The integrated preview renders a second page.
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`;
  await replaceEditorSource(tauriPage, source);
  await waitLong(
    tauriPage,
    `import("/src/store/project-index.ts").then(({ useIndexStore }) => {
      const state = useIndexStore.getState().intelligenceState;
      const data = state.data;
      const references = data?.uses.filter((use) => use.kind === "reference") ?? [];
      const citations = data?.uses.filter((use) => use.kind === "citation") ?? [];
      return state.status === "success"
        && data?.bibliography.entries.some((entry) => entry.key === "edge-source")
        && data?.definitions.some((definition) => definition.name === "sec:child")
        && references.length >= 2
        && citations.length >= 1
        && references.every((use) => use.resolution === "resolved")
        && citations.every((use) => use.resolution === "resolved");
    })`,
    60_000,
  );
  await waitLong(
    tauriPage,
    `import("/src/store/proofreading.ts").then(({ useProofreadingStore }) => {
      const source = useProofreadingStore.getState().source;
      const providers = new Set(source.diagnostics.map((item) => item.source));
      return (source.phase === "ready" || source.phase === "partial")
        && providers.has("harper")
        && providers.has("hunspell")
        && source.diagnostics.some(
          (item) => item.word.toLowerCase() === "qwertzuiopz",
        );
    })`,
    90_000,
  );
  await tauriPage.waitForFunction(
    `!!document.querySelector(".math-preview .katex")`,
    20_000,
  );
  const liveHighlighting = await tauriPage.evaluate<{
    spans: number;
    colors: number;
  }>(
    `(() => {
      const spans = Array.from(
        document.querySelectorAll(".cm-content .cm-line span[class]"),
      ).filter(
        (element) =>
          !Array.from(element.classList).some((name) =>
            name.startsWith("cm-lintRange"),
          ),
      );
      return {
        spans: spans.length,
        colors: new Set(
          spans.map((element) => getComputedStyle(element).color),
        ).size,
      };
    })()`,
  );
  expect(liveHighlighting.spans).toBeGreaterThan(10);
  expect(liveHighlighting.colors).toBeGreaterThan(2);

  await openRailTab(tauriPage, "Source Tree");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[aria-controls="project-structure-content"]')`,
    10_000,
  );
  const structureExpanded = await tauriPage.evaluate<boolean>(
    `document.querySelector('[aria-controls="project-structure-content"]')?.getAttribute("aria-expanded") === "true"`,
  );
  if (!structureExpanded) {
    await tauriPage.click('[aria-controls="project-structure-content"]');
  }
  await waitLong(
    tauriPage,
    `document.querySelector('[aria-label="Project structure"]')?.textContent?.includes("Core section") === true`,
    30_000,
  );
  await expect(
    tauriPage.locator('[aria-label="Project structure"]'),
  ).toContainText("Core section");
  // Filtering expands every matching ancestor and therefore verifies the
  // cross-file child without depending on a persisted tree expansion state.
  await tauriPage.getByLabel("Filter project structure").fill("Child result");
  await expect(
    tauriPage.locator('[aria-label="Project structure"]'),
  ).toContainText("Child result");

  await openRailTab(tauriPage, "References & citations (Shift-F12)");
  await tauriPage
    .locator('[role="tab"][aria-label^="Citations"]')
    .click();
  await expect(
    tauriPage.locator('[aria-label="Project citations"]'),
  ).toContainText("edge-source");
  await tauriPage.locator('[role="tab"][aria-label^="Symbols"]').click();
  await expect(
    tauriPage.locator('[aria-label="Project symbols"]'),
  ).toContainText("sec:child");

  await typeInEditorAfter(tauriPage, "CompletionAnchor", " \\tex");
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll(".cm-tooltip-autocomplete li"))
      .some((item) => item.textContent?.includes("\\\\textbf"))`,
    10_000,
  );
  await replaceEditorSource(tauriPage, source);
  await waitLong(
    tauriPage,
    `import("/src/store/project-index.ts").then(({ useIndexStore }) => {
      const state = useIndexStore.getState().intelligenceState;
      return state.status === "success"
        && state.data?.bibliography.entries.some(
          (entry) => entry.key === "edge-source",
        );
    })`,
    60_000,
  );
  await typeInEditorAfter(tauriPage, "CompletionAnchor", " \\cite{edge");
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll(".cm-tooltip-autocomplete li"))
      .some((item) => item.textContent?.includes("edge-source"))`,
    15_000,
  );
  await replaceEditorSource(tauriPage, source);

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.getByText("Core section", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(tauriPage.locator(".wysiwyg-math-preview .katex").first()).toBeVisible({
    timeout: 20_000,
  });
  await tauriPage.click('[aria-label="Switch to source view"]');
  await compileAndProbe(tauriPage, 180_000);
  await expect(tauriPage.locator(".pdf-canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  await activatePreviewControl(tauriPage, "Document outline");
  await expect(
    tauriPage.locator('[aria-label="PDF document outline"]'),
  ).not.toHaveAttribute("inert", "");
  await tauriPage.click('[aria-label="Close document outline"]');
  await activatePreviewControl(tauriPage, "Search PDF");
  await expect(
    tauriPage.locator('[aria-label="Search this PDF"]'),
  ).toBeVisible();
  await tauriPage.click('[aria-label="Close PDF search"]');
  await expectDesktopShellAnchored(tauriPage);
});

test("exact reversions and stale SyncTeX remain productive without a recompile", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await createBlankProject(
    tauriPage,
    `E2E Stale SyncTeX ${Date.now().toString(36)}`,
  );
  await tauriPage.evaluate(
    `import("/src/store/compile.ts").then(({ useCompileStore }) => {
      useCompileStore.getState().setAutoCompile(false);
      return true;
    })`,
  );
  // Each body line is its own paragraph. Consecutive source lines would
  // otherwise merge into a single LaTeX paragraph, and SyncTeX resolves a
  // click only to the enclosing paragraph — every point on the page would
  // map to the same source line, so the mapping under test could not be
  // observed at all.
  const body = Array.from({ length: 45 }, (_, index) =>
    index === 29
      ? "AnchorTarget appears on the mapped line."
      : `Stable source line ${index + 1}.`,
  );
  const original = [
    String.raw`\documentclass{article}`,
    String.raw`\begin{document}`,
    body.join("\n\n"),
    String.raw`\end{document}`,
  ].join("\n");
  await replaceEditorSource(tauriPage, original);
  await compileAndProbe(tauriPage, 180_000);
  const compiledRevision = await tauriPage.evaluate<number>(
    `import("/src/store/compile.ts").then(({ useCompileStore }) =>
      useCompileStore.getState().lastCompileCheckpoint?.outputRevision ?? -1,
    )`,
  );

  const modified = original.replace(
    String.raw`\begin{document}`,
    String.raw`\begin{document}` + "\nInserted line before the stable anchor.",
  );
  await replaceEditorSource(tauriPage, modified);
  await expect(tauriPage.getByTestId("preview-stale-badge")).toBeVisible({
    timeout: 20_000,
  });
  await setEditorCaretAfter(tauriPage, "AnchorTarget");
  await tauriPage.evaluate(
    `import("/src/features/synctex.ts").then(({ goToSyncTex }) => {
      goToSyncTex();
      return true;
    })`,
  );
  await expect(tauriPage.locator(".ll-synctex-hl")).toBeVisible({
    timeout: 20_000,
  });

  await goToLine(tauriPage, 1);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll(".textLayer span"))
      .some((element) => element.textContent?.includes("AnchorTarget"))`,
    30_000,
  );
  await tauriPage.evaluate(
    `(() => {
      const span = Array.from(document.querySelectorAll(".textLayer span"))
        .find((element) => element.textContent?.startsWith("AnchorTarget"));
      if (!span) throw new Error("AnchorTarget is unavailable in the PDF text layer");
      const rect = span.getBoundingClientRect();
      // Click the rendered word itself. The viewer resolves the clicked word
      // from the horizontal offset within the span, and the span carries the
      // whole rendered line, so its centre is a different word entirely.
      const anchorFraction =
        "AnchorTarget".length / 2 / (span.textContent ?? "x").length;
      span.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: rect.left + Math.max(1, rect.width * anchorFraction),
        clientY: rect.top + Math.max(1, rect.height / 2),
      }));
      return true;
    })()`,
  );
  await waitLong(
    tauriPage,
    `import("/src/components/editor/cm/controller.ts").then(
      ({ getCurrentLine, getEditorView }) => {
        const view = getEditorView();
        const line = getCurrentLine();
        return !!view && !!line
          && view.state.doc.line(line).text.includes("AnchorTarget");
      },
    )`,
    20_000,
  );

  await replaceEditorSource(tauriPage, original);
  await expect(tauriPage.getByTestId("preview-stale-badge")).toBeHidden({
    timeout: 20_000,
  });
  expect(
    await tauriPage.evaluate<number>(
      `import("/src/store/compile.ts").then(({ useCompileStore }) =>
        useCompileStore.getState().lastCompileCheckpoint?.outputRevision ?? -1,
      )`,
    ),
  ).toBe(compiledRevision);
  await expectDesktopShellAnchored(tauriPage);
});
