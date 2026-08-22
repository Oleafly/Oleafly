import { execFileSync, spawn } from "node:child_process";
import { existsSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  PluginClient,
  TauriPage,
} from "@srsholmes/tauri-playwright";

const ROOT = process.cwd();
const SERVER = "http://127.0.0.1:8787";
const DEV_TOKEN = "oleafly-local-e2e";
const FILE_ID = "0198cf35-0000-7000-8000-000000000002";
let relaunchedAliceProcess = null;

const bootstrapResponse = await fetch(`${SERVER}/v1/dev/bootstrap`, {
  method: "POST",
  headers: { Authorization: `Bearer ${DEV_TOKEN}` },
});
if (!bootstrapResponse.ok) {
  throw new Error(`Development bootstrap failed: ${bootstrapResponse.status}`);
}
const bootstrap = await bootstrapResponse.json();
if (!bootstrap.projectId || bootstrap.clients?.length !== 2) {
  throw new Error("Development bootstrap did not return two clients");
}
const descriptorResponse = await fetch(`${SERVER}/.well-known/oleafly-realtime`);
if (!descriptorResponse.ok) throw new Error("Server discovery failed");
const descriptor = await descriptorResponse.json();

let alice = await openPage(process.env.OLEAFLY_REALTIME_SOCKET_A);
const bob = await openPage(process.env.OLEAFLY_REALTIME_SOCKET_B);

try {
  const aliceProject = await createProject(alice, "Realtime Alice");
  const bobProject = await createProject(bob, "Realtime Bob");
  await connect(alice, aliceProject, bootstrap, bootstrap.clients[0], true);
  await waitForText(alice, "[data-testid='realtime-status']", "Saved to team");
  await connect(bob, bobProject, bootstrap, bootstrap.clients[1], false);
  await waitForText(bob, "[data-testid='realtime-status']", "Saved to team");

  const aliceGeneration = await runtimeGeneration(alice);
  await dispatchEdit(alice, " Alice-live");
  await waitForSavedAfter(alice, aliceGeneration);
  await waitForEditorText(bob, "Alice-live");
  await dispatchSelection(alice, 1, 6);
  await waitForCursorRange(bob, "Alice", 1, 6);
  const relocationGeneration = await runtimeGeneration(bob);
  await dispatchEditAt(bob, 0, "R");
  await waitForSavedAfter(bob, relocationGeneration);
  await waitForEditorText(alice, "R");
  await waitForCursorRange(bob, "Alice", 2, 7);

  const bobGeneration = await runtimeGeneration(bob);
  await dispatchEdit(bob, " Bob-live");
  await waitForSavedAfter(bob, bobGeneration);
  await waitForEditorText(alice, "Bob-live");
  await dispatchSelection(bob, 2, 7);
  await waitForCursorRange(alice, "Bob", 2, 7);

  execFileSync("docker", ["compose", "-f", "compose.realtime.dev.yaml", "stop", "realtime"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  await waitForText(alice, "[data-testid='realtime-status']", "Offline");
  await dispatchEdit(alice, " offline-safe");
  await waitForText(alice, "[data-testid='realtime-status']", "change safe locally");
  const bindingIdentity = {
    localProjectId: aliceProject,
    serverInstanceId: descriptor.serverInstanceId,
    projectId: bootstrap.projectId,
    replicaId: bootstrap.clients[0].replicaId,
    fileId: FILE_ID,
  };
  const pendingFrames = await hydratePendingFrames(alice, bindingIdentity);
  if (pendingFrames.length !== 1) {
    throw new Error(`Expected one pending frame before relaunch, got ${pendingFrames.length}`);
  }
  assertRealtimeCiphertextIsOpaque(process.env.OLEAFLY_REALTIME_DATA_A);

  alice.__client.disconnect();
  process.kill(Number(process.env.OLEAFLY_REALTIME_ALICE_PID), "SIGKILL");
  await waitForProcessExit(Number(process.env.OLEAFLY_REALTIME_ALICE_PID));
  rmSync(process.env.OLEAFLY_REALTIME_SOCKET_A, { force: true });
  execFileSync("docker", ["compose", "-f", "compose.realtime.dev.yaml", "start", "realtime"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  relaunchedAliceProcess = relaunchAlice();
  alice = await openPage(process.env.OLEAFLY_REALTIME_SOCKET_A);
  await openExistingProject(alice, aliceProject);
  await waitForSharedReadOnly(alice);
  await installReplayCapture(alice);
  await connect(alice, aliceProject, bootstrap, bootstrap.clients[0], false);
  await waitForExactReplayFrame(alice, pendingFrames[0]);
  await waitForEditorText(bob, "offline-safe", 30_000);
  await waitForText(alice, "[data-testid='realtime-status']", "Saved to team", 30_000);

  process.stdout.write("Realtime Desktop e2e passed: exact cursors, edits, encrypted WAL, and process-relaunch replay.\n");
} finally {
  execFileSync("docker", ["compose", "-f", "compose.realtime.dev.yaml", "start", "realtime"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  alice?.__client.disconnect();
  bob.__client.disconnect();
  relaunchedAliceProcess?.kill("SIGTERM");
}

async function openPage(socket) {
  if (!socket) throw new Error("Desktop bridge socket is missing");
  await poll(async () => existsSync(socket), 20_000, `Desktop bridge socket ${socket}`);
  const client = new PluginClient(socket);
  await client.connect();
  const ping = await client.send({ type: "ping" });
  if (!ping.ok) throw new Error(`Desktop bridge did not answer on ${socket}`);
  const page = new TauriPage(client);
  page.setDefaultTimeout(20_000);
  const window = await page.waitForWindow((candidate) => candidate.label === "main", {
    timeout: 20_000,
  });
  await window.waitForFunction(
    `document.readyState !== "loading" && (document.querySelector("#root")?.childElementCount ?? 0) > 0`,
    20_000,
  );
  window.__client = client;
  return window;
}

async function createProject(page, name) {
  return page.evaluate(`(async () => {
    const { useFilesStore } = await import("/src/store/files.ts");
    await useFilesStore.getState().createProject(${JSON.stringify(name)});
    return useFilesStore.getState().projectId;
  })()`);
}

async function openExistingProject(page, localProjectId) {
  await page.evaluate(`(async () => {
    const { useFilesStore } = await import("/src/store/files.ts");
    await useFilesStore.getState().openProject(${JSON.stringify(localProjectId)});
    return useFilesStore.getState().projectId;
  })()`);
}

async function connect(page, localProjectId, bootstrap, client, seedFromLocalFile) {
  const config = {
    baseUrl: SERVER,
    projectId: bootstrap.projectId,
    actorId: client.actorId,
    replicaId: client.replicaId,
    fileId: FILE_ID,
    devToken: DEV_TOKEN,
    seedFromLocalFile,
  };
  await page.evaluate(`(async () => {
    const { realtimeRuntime } = await import("/src/lib/realtime/runtime.ts");
    const { useFilesStore } = await import("/src/store/files.ts");
    const state = useFilesStore.getState();
    await realtimeRuntime.connect(
      ${JSON.stringify(config)},
      ${JSON.stringify(localProjectId)},
      "main.tex",
      state.files["main.tex"]?.content ?? ""
    );
    return true;
  })()`);
}

async function dispatchEdit(page, insert) {
  await page.evaluate(`(async () => {
    const { getEditorView } = await import("/packages/editor/src/controller.ts");
    const view = getEditorView();
    if (!view) throw new Error("Source editor is not mounted");
    view.dispatch({ changes: { from: view.state.doc.length, insert: ${JSON.stringify(insert)} } });
    return view.state.doc.toString();
  })()`);
}

async function dispatchEditAt(page, from, insert) {
  await page.evaluate(`(async () => {
    const { getEditorView } = await import("/packages/editor/src/controller.ts");
    const view = getEditorView();
    if (!view) throw new Error("Source editor is not mounted");
    view.dispatch({ changes: { from: ${Number(from)}, insert: ${JSON.stringify(insert)} } });
    return view.state.doc.toString();
  })()`);
}

async function dispatchSelection(page, anchor, head) {
  await page.evaluate(`(async () => {
    const { getEditorView } = await import("/packages/editor/src/controller.ts");
    const view = getEditorView();
    if (!view) throw new Error("Source editor is not mounted");
    view.dispatch({ selection: { anchor: ${anchor}, head: ${head} } });
    return true;
  })()`);
}

async function runtimeGeneration(page) {
  return page.evaluate(`(async () => {
    const { realtimeRuntime } = await import("/src/lib/realtime/runtime.ts");
    return realtimeRuntime.getSnapshot().generation;
  })()`);
}

async function waitForSavedAfter(page, generation) {
  await poll(async () => page.evaluate(`(async () => {
    const { realtimeRuntime } = await import("/src/lib/realtime/runtime.ts");
    const snapshot = realtimeRuntime.getSnapshot();
    return snapshot.generation > ${Number(generation)} &&
      snapshot.saveState?.kind === "saved_to_team";
  })()`), 20_000, `durable receipt after runtime generation ${generation}`);
}

async function waitForEditorText(page, expected, timeout = 20_000) {
  await poll(async () => {
    const text = await page.evaluate(`document.querySelector(".cm-content")?.textContent ?? ""`);
    return String(text).includes(expected);
  }, timeout, `editor text ${expected}`);
}

async function waitForSharedReadOnly(page) {
  await poll(async () => page.evaluate(`(async () => {
    const { getEditorView } = await import("/packages/editor/src/controller.ts");
    const view = getEditorView();
    const notice = document.querySelector("[data-testid='shared-source-readonly']");
    return Boolean(notice && view?.contentDOM.getAttribute("contenteditable") === "false");
  })()`), 20_000, "the relaunched shared file to fail closed before reconnect");
}

async function waitForCursorRange(page, displayName, expectedFrom, expectedTo) {
  const inspect = () => page.evaluate(`(async () => {
    const { getEditorView } = await import("/packages/editor/src/controller.ts");
    const view = getEditorView();
    if (!view) return null;
    const selection = [...document.querySelectorAll(".cm-collaborator-selection")]
      .find((element) => element.getAttribute("title") === ${JSON.stringify(`${displayName}'s selection`)});
    const cursor = [...document.querySelectorAll(".cm-collaborator-cursor")]
      .find((element) => element.getAttribute("title") === ${JSON.stringify(displayName)});
    if (!selection || !cursor || !cursor.parentNode) return null;
    const from = view.posAtDOM(selection, 0);
    const to = view.posAtDOM(selection, selection.childNodes.length);
    const cursorOffset = [...cursor.parentNode.childNodes].indexOf(cursor);
    const head = view.posAtDOM(cursor.parentNode, cursorOffset);
    return { from, to, head, text: selection.textContent, document: view.state.doc.toString() };
  })()`);
  let last = null;
  try {
    await poll(async () => {
      last = await inspect();
      return last?.from === expectedFrom && last?.to === expectedTo &&
        last?.head === expectedTo &&
        last?.text === last?.document.slice(expectedFrom, expectedTo);
    }, 20_000, `${displayName} cursor range ${expectedFrom}-${expectedTo}`);
  } catch (error) {
    throw new Error(`${String(error)}; last cursor was ${JSON.stringify(last)}`);
  }
}

async function hydratePendingFrames(page, identity) {
  return page.evaluate(`(async () => {
    const { TauriRealtimeDesktopPort } = await import("/src/lib/realtime/tauri-desktop-port.ts");
    const hydration = await new TauriRealtimeDesktopPort().hydrateReplica(${JSON.stringify(identity)});
    return hydration.pending.map((entry) => {
      let binary = "";
      for (const byte of entry.encodedFrame) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
  })()`);
}

async function installReplayCapture(page) {
  await page.evaluate(`(async () => {
    const { subscribeNativeReplayForE2e } = await import("/src/lib/realtime/tauri-desktop-port.ts");
    window.__oleaflyReplayFrames = [];
    window.__oleaflyReplayUnlisten = await subscribeNativeReplayForE2e((frame) => {
      window.__oleaflyReplayFrames.push(frame);
    });
  })()`);
}

async function waitForExactReplayFrame(page, expected) {
  await poll(
    async () => page.evaluate(
      `window.__oleaflyReplayFrames?.includes(${JSON.stringify(expected)}) ?? false`,
    ),
    30_000,
    "the exact original native WAL frame to replay",
  );
}

function assertRealtimeCiphertextIsOpaque(dataDirectory) {
  if (!dataDirectory) throw new Error("Alice data directory is missing");
  const realtimeDirectory = join(dataDirectory, "realtime-v1");
  const files = existsSync(realtimeDirectory) ? readdirSync(realtimeDirectory) : [];
  if (files.length === 0) throw new Error("Encrypted realtime storage was not created");
  const disk = Buffer.concat(files.map((file) => readFileSync(join(realtimeDirectory, file))));
  for (const forbidden of [
    "offline-safe",
    DEV_TOKEN,
    process.env.OLEAFLY_REALTIME_TEST_KEY,
  ]) {
    if (forbidden && disk.includes(Buffer.from(forbidden))) {
      throw new Error(`Encrypted realtime storage contains forbidden plaintext: ${forbidden}`);
    }
  }
}

function relaunchAlice() {
  const app = process.env.OLEAFLY_REALTIME_APP;
  const log = process.env.OLEAFLY_REALTIME_ALICE_LOG;
  if (!app || !log) throw new Error("Desktop relaunch environment is incomplete");
  const logFd = openSync(log, "a");
  return spawn(app, [], {
    env: {
      ...process.env,
      OLEAFLY_DATA_DIR: process.env.OLEAFLY_REALTIME_DATA_A,
      OLEAFLY_REALTIME_TEST_KEY: process.env.OLEAFLY_REALTIME_TEST_KEY,
      TAURI_PLAYWRIGHT_SOCKET: process.env.OLEAFLY_REALTIME_SOCKET_A,
      OLEAFLY_E2E_BOOT_LOCALSTORAGE: process.env.OLEAFLY_REALTIME_BOOT_SEED,
      OLEAFLY_E2E_WINDOW: "900x700",
    },
    stdio: ["ignore", logFd, logFd],
  });
}

async function waitForProcessExit(pid) {
  await poll(async () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }, 10_000, `Desktop process ${pid} to exit`);
}

async function waitForText(page, selector, expected, timeout = 20_000) {
  let lastText = "";
  try {
    await poll(async () => {
      const text = await page.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`,
      );
      lastText = String(text);
      return lastText.includes(expected);
    }, timeout, `${selector} text ${expected}`);
  } catch (error) {
    throw new Error(`${String(error)}; last text was ${JSON.stringify(lastText)}`);
  }
}

async function poll(check, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
