import { test, expect } from "../fixtures";
import { openSettings, type Page } from "../helpers";
import { scriptValue } from "../script-value";

const LOAD_TIMEOUT_MS = 60_000;
const RUNTIME_URL = /^(?:oleafly-artifact:\/\/localhost|http:\/\/oleafly-artifact\.localhost)\/runtime\/[0-9a-f]{64}\.js$/;
const FRAME_ORIGIN = process.platform === "win32" ? "http://oleafly-artifact.localhost" : "oleafly-artifact://localhost";
const LOAD_FAILED = "This block couldn't load.";
const START_FAILED = "This block couldn't start";

interface Probe {
  block: "jsx" | "html";
  slash: string;
  item: string;
  source: string;
  marker: string;
  height: number;
}

const REACT_PROBE: Probe = {
  block: "jsx",
  slash: "/react",
  item: "block:jsx",
  marker: "RuntimeProbe",
  height: 271,
  source: [
    "export default function RuntimeProbe() {",
    '  return <div style={{ height: 271, background: "#2563eb", color: "#ffffff" }}>React runtime ready</div>;',
    "}",
  ].join("\n"),
};

const HTML_PROBE: Probe = {
  block: "html",
  slash: "/html",
  item: "block:html",
  marker: "runtime-probe",
  height: 293,
  source: [
    '<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>',
    "<style>body { margin: 0; padding: 0; }</style>",
    '<div id="runtime-probe"></div>',
    '<script>d3.select("#runtime-probe").style("height", "293px").style("background", "#16a34a").text("d3 runtime ready");</script>',
  ].join("\n"),
};

interface BlockState {
  found: boolean;
  probe: boolean;
  run: boolean;
  frame: boolean;
  src: string;
  sandbox: string;
  height: string;
  stalled: boolean;
  alert: string;
  failed: boolean;
}

function inNote(noteId: string, body: string): string {
  return `(() => {
    const view = Array.from(document.querySelectorAll("[data-note-view]")).find(
      (candidate) => candidate.getAttribute("data-note-view") === ${scriptValue(noteId)} && candidate.getClientRects().length > 0,
    );
    const surface = view ? view.querySelector(".note-body .ProseMirror") : null;
    const editor = surface && surface.editor && !surface.editor.isDestroyed ? surface.editor : null;
    ${body}
  })()`;
}

function inBlock(noteId: string, probe: Probe, body: string): string {
  return inNote(
    noteId,
    `const host = surface ? surface.querySelector(${scriptValue(`.note-drawn[data-block="${probe.block}"]`)}) : null;
    const preview = host ? host.querySelector(".note-drawn-preview") : null;
    if (!preview) return null;
    ${body}`,
  );
}

async function notesEnabled(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => useSettingsStore.getState().notes === true)`,
  );
}

async function turnNotesOn(page: Page): Promise<boolean> {
  if (await notesEnabled(page)) return false;
  await openSettings(page, "experimentation");
  const toggle = page.getByTestId("settings-notes");
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await page.evaluate(
    `(() => { const toggle = document.querySelector('[data-testid="settings-notes"]'); if (toggle && toggle.getAttribute("aria-checked") !== "true") toggle.click(); return true; })()`,
  );
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.click('[data-testid="settings-close"]');
  await page.waitForFunction(`!document.querySelector('[data-testid="settings-close"]')`, 10_000);
  await expect.poll(() => notesEnabled(page), { timeout: 10_000 }).toBe(true);
  return true;
}

async function openNotes(page: Page) {
  await page.waitForFunction(
    `(() => {
      const ready = Array.from(document.querySelectorAll('button[aria-label="New note"]')).some(
        (button) => !button.disabled && button.getClientRects().length > 0,
      );
      if (ready) return true;
      const library = document.querySelector('[data-testid="library"][data-projects-loaded="true"]');
      const dock = document.querySelector('[data-testid="open-notes"]');
      const last = window.__e2eNotesOpenedAt || 0;
      if (library && dock instanceof HTMLElement && dock.getClientRects().length > 0 && Date.now() - last > 2000) {
        window.__e2eNotesOpenedAt = Date.now();
        dock.click();
      }
      return false;
    })()`,
    60_000,
  );
}

async function createNote(page: Page): Promise<string> {
  const before = await page.evaluate<string[]>(
    `Array.from(document.querySelectorAll("[data-note-view]"), (view) => view.getAttribute("data-note-view") || "")`,
  );
  await page.waitForFunction(
    `(() => {
      const button = Array.from(document.querySelectorAll('button[aria-label="New note"]')).find(
        (candidate) => !candidate.disabled && candidate.getClientRects().length > 0,
      );
      if (!button) return false;
      button.click();
      return true;
    })()`,
    20_000,
  );
  let noteId = "";
  await expect
    .poll(
      async () => {
        noteId = await page.evaluate<string>(
          `(() => {
            const known = new Set(${scriptValue(before)});
            const view = Array.from(document.querySelectorAll("[data-note-view]")).find((candidate) => {
              const id = candidate.getAttribute("data-note-view") || "";
              if (!id || known.has(id) || candidate.getClientRects().length === 0) return false;
              const surface = candidate.querySelector(".note-body .ProseMirror");
              return Boolean(surface && surface.editor && surface.editor.isEditable);
            });
            return view ? view.getAttribute("data-note-view") : "";
          })()`,
        );
        return noteId;
      },
      { message: "the new note never opened with an editable body", timeout: 30_000 },
    )
    .not.toBe("");
  return noteId;
}

async function insertFromSlashMenu(page: Page, noteId: string, probe: Probe) {
  const typed = await page.evaluate<boolean>(
    inNote(
      noteId,
      `if (!editor) return false;
      return editor.chain().focus("end").insertContent(${scriptValue(probe.slash)}).run();`,
    ),
  );
  expect(typed, `typing ${probe.slash} into the note`).toBe(true);
  const keyboardAfter = Date.now() + 3_000;
  await page.waitForFunction(
    inNote(
      noteId,
      `const option = document.querySelector(${scriptValue(`[role="listbox"] [data-slash-item="${probe.item}"]`)});
      if (option) {
        option.click();
        return true;
      }
      if (!surface || surface.getAttribute("aria-expanded") !== "true" || Date.now() < ${keyboardAfter}) return false;
      surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      return true;`,
    ),
    15_000,
  );
  await expect
    .poll(
      () =>
        page.evaluate<boolean>(
          inNote(
            noteId,
            `if (!editor) return false;
            let found = null;
            editor.state.doc.descendants((node, pos) => {
              if (node.type.name === "codeBlock" && node.attrs.language === ${scriptValue(probe.block)}) found = { node, pos };
            });
            if (!found) return false;
            const from = found.pos + 1;
            if (found.node.textContent !== ${scriptValue(probe.source)}) {
              editor.view.dispatch(editor.state.tr.insertText(${scriptValue(probe.source)}, from, from + found.node.content.size));
            }
            return editor.state.doc.nodeAt(found.pos).textContent === ${scriptValue(probe.source)};`,
          ),
        ),
      { message: `the ${probe.block} block never took the probe source`, timeout: 15_000 },
    )
    .toBe(true);
}

async function blockState(page: Page, noteId: string, probe: Probe): Promise<BlockState | null> {
  return page.evaluate<BlockState | null>(
    inBlock(
      noteId,
      probe,
      `preview.scrollIntoView({ block: "nearest" });
      const frame = preview.querySelector("[data-artifact-frame] iframe");
      const alert = preview.querySelector('[data-artifact-frame] [role="alert"]');
      const text = preview.textContent || "";
      const marker = ${scriptValue(probe.marker)};
      return {
        found: true,
        probe: text.includes(marker) || preview.innerHTML.includes(marker),
        run: Array.from(preview.querySelectorAll("button")).some((button) => (button.textContent || "").trim() === "Run"),
        frame: frame !== null,
        src: frame ? frame.getAttribute("src") || "" : "",
        sandbox: frame ? frame.getAttribute("sandbox") || "" : "",
        height: frame ? frame.style.height : "",
        stalled: preview.querySelector("[data-artifact-stalled]") !== null,
        alert: alert ? (alert.textContent || "").trim() : "",
        failed: text.includes(${scriptValue(LOAD_FAILED)}) || text.includes(${scriptValue(START_FAILED)}),
      };`,
    ),
  );
}

async function runBlock(page: Page, noteId: string, probe: Probe) {
  await expect
    .poll(() => blockState(page, noteId, probe), {
      message: `the ${probe.block} block never offered Run for the probe source`,
      timeout: 20_000,
    })
    .toMatchObject({ found: true, probe: true, run: true, frame: false, failed: false });
  const clicked = await page.evaluate<boolean>(
    inBlock(
      noteId,
      probe,
      `const button = Array.from(preview.querySelectorAll("button")).find((candidate) => (candidate.textContent || "").trim() === "Run");
      if (!button) return false;
      button.scrollIntoView({ block: "nearest" });
      button.click();
      return true;`,
    ),
  );
  expect(clicked, `clicking Run on the ${probe.block} block`).toBe(true);
}

async function expectLoaded(page: Page, noteId: string, probe: Probe, timeout = LOAD_TIMEOUT_MS) {
  await expect
    .poll(() => blockState(page, noteId, probe), {
      message: `the ${probe.block} block never reported the ${probe.height}px its runtime renders`,
      timeout,
    })
    .toMatchObject({
      found: true,
      run: false,
      frame: true,
      sandbox: "allow-scripts",
      height: `${probe.height}px`,
      stalled: false,
      alert: "",
      failed: false,
    });
  const state = await blockState(page, noteId, probe);
  expect(state?.src.startsWith(`${FRAME_ORIGIN}/`), `frame address ${state?.src}`).toBe(true);
}

async function recycleNote(page: Page, noteId: string) {
  await page.evaluate(
    `Promise.all([import("/src/lib/tauri.ts"), import("/src/store/files.ts")]).then(async ([tauri, files]) => {
      await tauri.recycleProject(${scriptValue(noteId)});
      await files.useFilesStore.getState().refreshProjects();
      return true;
    })`,
  );
}

test("scripted React and HTML blocks in a note load the artifact runtime after Run", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  const turnedOn = await turnNotesOn(tauriPage);
  let noteId = "";
  try {
    const runtimeUrl = await tauriPage.evaluate<string>(
      `import("/src/lib/tauri.ts").then(({ artifactFrameRuntimeUrl }) => artifactFrameRuntimeUrl())`,
    );
    expect(runtimeUrl).toMatch(RUNTIME_URL);
    expect(runtimeUrl.startsWith(`${FRAME_ORIGIN}/runtime/`), `runtime address ${runtimeUrl}`).toBe(true);

    await openNotes(tauriPage);
    noteId = await createNote(tauriPage);
    await insertFromSlashMenu(tauriPage, noteId, REACT_PROBE);
    await insertFromSlashMenu(tauriPage, noteId, HTML_PROBE);

    await runBlock(tauriPage, noteId, REACT_PROBE);
    await expectLoaded(tauriPage, noteId, REACT_PROBE);

    await runBlock(tauriPage, noteId, HTML_PROBE);
    await expectLoaded(tauriPage, noteId, HTML_PROBE);

    await expectLoaded(tauriPage, noteId, REACT_PROBE, 10_000);
  } finally {
    if (noteId) await recycleNote(tauriPage, noteId).catch(() => undefined);
    if (turnedOn) {
      await tauriPage
        .evaluate(`import("/src/store/settings.ts").then(({ useSettingsStore }) => { useSettingsStore.getState().setNotes(false); return true; })`)
        .catch(() => undefined);
    }
  }
});
