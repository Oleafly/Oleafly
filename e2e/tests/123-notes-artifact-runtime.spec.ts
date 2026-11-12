import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "../fixtures";
import type { TauriPage } from "@srsholmes/tauri-playwright";
import type { Page } from "../helpers";
import { caretAtEnd, createNote, inNote, openNotes, recycleNote, turnNotesOff, turnNotesOn } from "../notes-app";
import { scriptValue } from "../script-value";

const LOAD_TIMEOUT_MS = 60_000;
const LEAVE_AFTER_MS = 4_000;
const LEAVE_SETTLE_MS = 8_000;
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

function leaveProbe(address: string): Probe {
  return {
    block: "html",
    slash: "/html",
    item: "block:html",
    marker: "leave-probe",
    height: 199,
    source: [
      "<style>body { margin: 0; padding: 0; }</style>",
      `<div id="leave-probe" style="height: 199px" data-target="${address}">leave probe</div>`,
      `<script>setTimeout(() => { const probe = document.getElementById("leave-probe"); location.href = probe.dataset.target + "?note=" + encodeURIComponent(probe.textContent); }, ${LEAVE_AFTER_MS});</script>`,
    ].join("\n"),
  };
}

async function startLeaveTarget(): Promise<{ address: string; hits: () => number; close: () => Promise<void> }> {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits += 1;
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>left</title><p>left the note</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    address: `http://127.0.0.1:${port}/leave`,
    hits: () => hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

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

function inBlock(noteId: string, probe: Probe, body: string): string {
  return inNote(
    noteId,
    `const host = surface ? surface.querySelector(${scriptValue(`[data-block="${probe.block}"]`)}) : null;
    const preview = host ? host.querySelector("[data-scripted-block]") : null;
    if (!preview) return null;
    ${body}`,
  );
}

async function insertFromSlashMenu(page: TauriPage, noteId: string, probe: Probe) {
  await caretAtEnd(page, noteId);
  const placed = await page.evaluate<boolean>(
    inNote(
      noteId,
      `if (!editor) return false;
      const parent = editor.state.selection.$from.parent;
      return parent.type.name === "paragraph" && parent.content.size === 0;`,
    ),
  );
  expect(placed, "the caret on an empty line at the end of the note").toBe(true);
  await page.keyboard.insertText(probe.slash);
  await page.waitForFunction(
    `document.querySelector(${scriptValue(`[role="listbox"] [data-slash-item="${probe.item}"][aria-selected="true"]`)}) !== null`,
    15_000,
  );
  await page.keyboard.press("Enter");
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
    if (turnedOn) await turnNotesOff(tauriPage);
  }
});

test("a block that sends its frame to a web address keeps the app in place and never reruns", async ({ tauriPage }) => {
  test.setTimeout(150_000);
  const target = await startLeaveTarget();
  const turnedOn = await turnNotesOn(tauriPage);
  let noteId = "";
  try {
    const appAddress = await tauriPage.evaluate<string>("location.href");
    await openNotes(tauriPage);
    noteId = await createNote(tauriPage);
    const probe = leaveProbe(target.address);
    await insertFromSlashMenu(tauriPage, noteId, probe);
    await runBlock(tauriPage, noteId, probe);
    await expectLoaded(tauriPage, noteId, probe, LEAVE_AFTER_MS + LOAD_TIMEOUT_MS);
    const running = await blockState(tauriPage, noteId, probe);
    const since = Date.now();
    const sources = new Set<string>([running?.src ?? ""]);
    await expect
      .poll(
        async () => {
          const state = await blockState(tauriPage, noteId, probe);
          if (state?.src) sources.add(state.src);
          return Boolean(state?.stalled) || Date.now() - since > LEAVE_AFTER_MS + LEAVE_SETTLE_MS;
        },
        { message: "the block never settled after trying to leave its frame", timeout: LEAVE_AFTER_MS + LEAVE_SETTLE_MS + 10_000 },
      )
      .toBe(true);
    const settled = await blockState(tauriPage, noteId, probe);
    expect(await tauriPage.evaluate<string>("location.href")).toBe(appAddress);
    expect([...sources], "the block was rebuilt after leaving its frame").toHaveLength(1);
    expect(target.hits(), "the block reached the web address more than once").toBeLessThanOrEqual(1);
    if (process.platform === "darwin") expect(target.hits(), "the app refuses the navigation before any request").toBe(0);
    if (target.hits() === 1 || !settled?.frame) {
      expect(settled, "a block that tried to leave its frame is stopped").toMatchObject({ frame: false, stalled: true });
    } else {
      expect(settled, "a frame whose navigation was refused keeps its own document").toMatchObject({
        frame: true,
        stalled: false,
        src: running?.src,
      });
    }
  } finally {
    await target.close().catch(() => undefined);
    if (noteId) await recycleNote(tauriPage, noteId).catch(() => undefined);
    if (turnedOn) await turnNotesOff(tauriPage);
  }
});
