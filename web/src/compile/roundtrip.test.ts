import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeEngine } from "@oleafly/compile-port/testing";
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import type { WebApi } from "../api";
import { ProjectController } from "../controller";
import type { CollabOutputInfo } from "../protocol";
import { patchCompile, resetWebState, useWeb } from "../store";
import { loadSyncTex } from "../synctex";
import { FakeServer, ManualTimers } from "../testing/fake-socket";
import { outputKey } from "./outputs";
import { forwardSync, type SyncView } from "./sync";
import { syncTexOpener } from "./synctex";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasm = readFileSync(path.join(here, "../synctex/oleafly_synctex.wasm"));

const MAIN = [
  "\\documentclass{article}",
  "\\begin{document}",
  "We model sea ice drift.",
  "\\input{sections/intro}",
  "The end.",
  "\\end{document}",
].join("\n");
const INTRO = "\\section{Introduction}\nSea ice moves with wind and ocean currents.\n";
const FILES = [
  { fileId: "f-main", path: "main.tex", kind: "text" },
  { fileId: "f-intro", path: "sections/intro.tex", kind: "text" },
];
const ME = { accountId: "me", name: "Me", avatarUrl: null, login: null, email: null };

function api() {
  const uploads: { kind: string; bytes: Uint8Array; mainFile: string }[] = [];
  let shared: Uint8Array | null = null;
  const fake = {
    me: vi.fn(async () => ME),
    projects: vi.fn(async () => []),
    project: vi.fn(async () => {
      throw new Error("offline");
    }),
    texts: vi.fn(async () => [
      { fileId: "f-main", path: "main.tex", text: MAIN },
      { fileId: "f-intro", path: "sections/intro.tex", text: INTRO },
    ]),
    blob: vi.fn(),
    output: vi.fn(async () => shared),
    putOutput: vi.fn(async (_project: string, kind: "pdf" | "synctex", bytes: Uint8Array, mainFile: string) => {
      uploads.push({ kind, bytes, mainFile });
      const info: CollabOutputInfo = { kind, size: bytes.length, compiledBy: "me", compiledAt: 5_000, mainFile };
      return info;
    }),
    signOut: vi.fn(),
  };
  return { api: fake as unknown as WebApi, uploads, share: (bytes: Uint8Array) => (shared = bytes) };
}

async function opened() {
  resetWebState({ me: ME });
  const server = api();
  const socket = new FakeServer();
  const controller = new ProjectController("p1", {
    api: server.api,
    socketUrl: "wss://collab.test/web/ws?project=p1",
    createSocket: socket.factory,
    setTimer: new ManualTimers().setTimer,
    random: () => 0.5,
    engines: async () => [createFakeEngine()],
    openSyncTex: syncTexOpener(() => loadSyncTex(wasm)),
  });
  await controller.start();
  socket.current.emit({ t: "hello", role: "owner", features: {}, files: FILES, compile: { main_doc: "f-main", engine: "latex" } });
  await vi.waitFor(() => expect(useWeb.getState().compile.ready).toBe(true));
  return { controller, server };
}

function view(line: number) {
  const shown: { page: number; x: number; y: number; width: number; height: number }[] = [];
  const sync: SyncView = { cursor: () => ({ line, word: null }), pageText: async () => null, show: (rect) => shown.push(rect) };
  return { sync, shown };
}

describe("compiling in the browser", () => {
  it("compiles, syncs both ways on its own output, and shares the PDF and SyncTeX", async () => {
    const { controller, server } = await opened();
    await controller.compiler.compile();
    const output = useWeb.getState().compile.output;
    expect(output).toMatchObject({ ok: true, target: { mainDocument: "main.tex", engine: "latex" } });

    const index = await controller.compiler.syncIndex();
    if (!index) throw new Error("no SyncTeX for this browser's compile");
    const intro = view(2);
    expect(await forwardSync(index, "sections/intro.tex", intro.sync)).toBe(true);
    const [rect] = intro.shown;
    expect(rect).toMatchObject({ page: 1 });
    expect(await index.inverse(rect.page, rect.x + 2, rect.y + rect.height / 2)).toEqual({
      file: "sections/intro.tex",
      line: 2,
      column: 0,
    });
    await controller.openFromPdf(rect.page, rect.x + 2, rect.y + rect.height / 2);
    expect(useWeb.getState().activeFileId).toBe("f-intro");

    await vi.waitFor(() => expect(server.uploads.map((upload) => upload.kind)).toEqual(["pdf", "synctex"]));
    expect(server.uploads.every((upload) => upload.mainFile === "main.tex")).toBe(true);
    expect(server.uploads[0]?.bytes).toEqual(output?.pdf);
    expect(server.uploads[1]?.bytes).toEqual(output?.synctex);
    controller.stop();
  });

  it("syncs on a PDF another computer compiled, whatever folder it compiled in", async () => {
    const { controller, server } = await opened();
    await controller.compiler.compile();
    const local = useWeb.getState().compile.output?.synctex;
    if (!local) throw new Error("the test engine wrote no SyncTeX");
    const elsewhere = strFromU8(gunzipSync(local)).replaceAll(/^Input:(\d+):/gmu, "Input:$1:/home/ana/thesis/");
    server.share(gzipSync(strToU8(elsewhere)));
    const pdf: CollabOutputInfo = { kind: "pdf", size: 10, compiledBy: "ana", compiledAt: 9_000, mainFile: "main.tex" };
    useWeb.setState({
      output: [pdf, { kind: "synctex", size: 10, compiledBy: "ana", compiledAt: 9_001, mainFile: "main.tex" }],
    });
    expect(useWeb.getState().compile.shown).toBe("shared");
    patchCompile({ shownShared: outputKey(pdf) });
    const index = await controller.compiler.syncIndex();
    if (!index) throw new Error("no SyncTeX for the shared PDF");
    const main = view(5);
    expect(await forwardSync(index, "main.tex", main.sync)).toBe(true);
    const [rect] = main.shown;
    expect(await index.inverse(rect.page, rect.x + 2, rect.y + rect.height / 2)).toEqual({
      file: "main.tex",
      line: 5,
      column: 0,
    });
    controller.stop();
  });
});
