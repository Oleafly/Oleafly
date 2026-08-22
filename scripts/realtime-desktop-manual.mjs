import { existsSync } from "node:fs";
import { PluginClient, TauriPage } from "@srsholmes/tauri-playwright";

const SERVER = "http://127.0.0.1:8787";
const DEV_TOKEN = "oleafly-local-e2e";
const FILE_ID = "0198cf35-0000-7000-8000-000000000002";

const bootstrapResponse = await fetch(`${SERVER}/v1/dev/bootstrap`, {
  method: "POST",
  headers: { Authorization: `Bearer ${DEV_TOKEN}` },
});
if (!bootstrapResponse.ok) {
  throw new Error(`Development bootstrap failed: ${bootstrapResponse.status}`);
}
const bootstrap = await bootstrapResponse.json();
if (!bootstrap.projectId || bootstrap.clients?.length !== 2) {
  throw new Error("Development bootstrap did not return Alice and Bob");
}

const alice = await openPage(process.env.OLEAFLY_REALTIME_SOCKET_A);
const bob = await openPage(process.env.OLEAFLY_REALTIME_SOCKET_B);

try {
  const aliceProject = await createProject(alice, "Realtime Alice");
  const bobProject = await createProject(bob, "Realtime Bob");
  await connect(alice, aliceProject, bootstrap, bootstrap.clients[0], true);
  await waitForSaved(alice);
  await connect(bob, bobProject, bootstrap, bootstrap.clients[1], false);
  await waitForSaved(bob);
  await waitForSameDocument(alice, bob);

  process.stdout.write(
    `\nAlice and Bob are connected to shared project ${bootstrap.projectId}.\n` +
      "Edit Source mode in either window to test live text and cursors.\n\n",
  );
} finally {
  alice.__client.disconnect();
  bob.__client.disconnect();
}

async function openPage(socket) {
  if (!socket) throw new Error("Desktop bridge socket is missing");
  await poll(() => existsSync(socket), 30_000, `Desktop bridge socket ${socket}`);
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
  })()`);
}

async function waitForSaved(page) {
  await poll(
    () =>
      page.evaluate(`(async () => {
        const { realtimeRuntime } = await import("/src/lib/realtime/runtime.ts");
        const snapshot = realtimeRuntime.getSnapshot();
        return snapshot.connection === "connected" &&
          snapshot.saveState?.kind === "saved_to_team";
      })()`),
    30_000,
    "Saved to team",
  );
}

async function waitForSameDocument(alice, bob) {
  await poll(async () => {
    const [aliceText, bobText] = await Promise.all([
      editorText(alice),
      editorText(bob),
    ]);
    return aliceText.length > 0 && aliceText === bobText;
  }, 30_000, "matching Alice and Bob documents");
}

async function editorText(page) {
  return page.evaluate(`document.querySelector(".cm-content")?.textContent ?? ""`);
}

async function poll(check, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
