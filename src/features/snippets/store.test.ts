// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSnippetFile, type SnippetRecord } from "@oleafly/snippets";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnippetFileEntry } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  listSnippetFiles: vi.fn<() => Promise<SnippetFileEntry[]>>(),
  writeSnippetFile: vi.fn<(name: string, text: string) => Promise<void>>(),
  logError: vi.fn(async () => undefined),
}));

vi.mock("@/lib/tauri", () => ({
  listSnippetFiles: mocks.listSnippetFiles,
  writeSnippetFile: mocks.writeSnippetFile,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@oleafly/snippets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oleafly/snippets")>();
  return {
    ...actual,
    parseSnippetFile: (...args: Parameters<typeof actual.parseSnippetFile>) => {
      if (args[0].includes('"$overflow"')) throw new RangeError("Maximum call stack size exceeded");
      return actual.parseSnippetFile(...args);
    },
  };
});

type StoreModule = typeof import("./store");

const addListener = vi.spyOn(window, "addEventListener");

function focusListeners(): EventListenerOrEventListenerObject[] {
  return addListener.mock.calls.filter(([type]) => type === "focus").map(([, listener]) => listener);
}

const PUBLIC = resolve(process.cwd(), "public/snippets");
const KNOWN = ["fast-math-latex", "fast-math-typst", "paper-structure"];
const disk = new Map<string, { text: string | null; error: string | null; modifiedMs: number }>();
let clock = 1;
const fetchMock = vi.fn(async (url: string) => {
  const name = url.replace(/^\/snippets\//u, "");
  try {
    const text = readFileSync(resolve(PUBLIC, name), "utf8");
    return { ok: true, status: 200, text: async () => text };
  } catch {
    return { ok: false, status: 404, text: async () => "" };
  }
});

function put(name: string, text: string | null, error: string | null = null): void {
  clock += 1;
  disk.set(name, { text, error, modifiedMs: clock });
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function written(name: string): string | undefined {
  return mocks.writeSnippetFile.mock.calls.filter(([file]) => file === name).at(-1)?.[1];
}

function userRecord(id: string, entry: Record<string, unknown>, collection = "mine"): SnippetRecord {
  const [record] = parseSnippetFile(json({ [id]: entry }), collection, "user").records;
  return record;
}

async function fresh(): Promise<StoreModule> {
  vi.resetModules();
  return import("./store");
}

async function loaded(): Promise<StoreModule> {
  const module = await fresh();
  await module.useSnippetStore.getState().load();
  return module;
}

const MINE = { "mine.fraction": { prefix: "ff", body: "\\frac{$1}{$2}", languages: ["latex"] } };

beforeEach(() => {
  disk.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mocks.listSnippetFiles.mockReset();
  mocks.writeSnippetFile.mockReset();
  mocks.listSnippetFiles.mockImplementation(async () =>
    [...disk.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([name, file]) => ({ name, ...file })),
  );
  mocks.writeSnippetFile.mockImplementation(async (name, text) => put(name, text));
});

afterEach(() => {
  for (const listener of focusListeners()) window.removeEventListener("focus", listener);
  vi.unstubAllGlobals();
});

describe("loading the library", () => {
  it("has the bundled packs as soon as loading starts, before the folder is read", async () => {
    let listed: (entries: SnippetFileEntry[]) => void = () => undefined;
    mocks.listSnippetFiles.mockImplementationOnce(() => new Promise((resolve) => (listed = resolve)));
    const { useSnippetStore } = await fresh();
    expect(useSnippetStore.getState()).toMatchObject({ status: "idle", files: [] });
    expect(useSnippetStore.getState().library.byId("latex.slash.section")).toBeUndefined();
    expect(useSnippetStore.getState().library.forLanguage("latex").prefixSorted).toEqual([]);
    const done = useSnippetStore.getState().load();
    expect(useSnippetStore.getState().status).toBe("loading");
    await vi.waitFor(() => expect(useSnippetStore.getState().library.byId("latex.slash.section")?.trigger).toBe("/section"));
    await vi.waitFor(() => expect(mocks.listSnippetFiles).toHaveBeenCalled());
    expect(useSnippetStore.getState().status).toBe("loading");
    listed([]);
    await done;
    expect(useSnippetStore.getState().status).toBe("ready");
  });

  it("merges the bundled packs, the fetched packs, user files and _state.json", async () => {
    put("mine.json", json(MINE));
    put(
      "_state.json",
      json({
        disabledCollections: ["builtin-markdown-slash"],
        knownCollections: KNOWN,
        overrides: [{ id: "latex.slash.section", collection: "builtin-latex-slash", patch: { trigger: "/sec" } }],
        disabledRegex: ["fm.subscript"],
      }),
    );
    const { useSnippetStore } = await loaded();
    const { files, library, state } = useSnippetStore.getState();
    expect(files.map((file) => [file.collection, file.records[0]?.layer])).toEqual([
      ["builtin-latex-at", "builtin"],
      ["builtin-latex-slash", "builtin"],
      ["builtin-markdown-slash", "builtin"],
      ["builtin-typst-slash", "builtin"],
      ["fast-math-latex", "pack"],
      ["fast-math-typst", "pack"],
      ["paper-structure", "pack"],
      ["mine", "user"],
    ]);
    expect(state.disabledCollections).toEqual(["builtin-markdown-slash"]);
    expect(library.byId("mine.fraction")?.trigger).toBe("ff");
    expect(library.byId("latex.slash.section")?.trigger).toBe("/sec");
    expect(library.byId("fm.fraction")).toBeDefined();
    expect(library.byId("fm.subscript")).toBeUndefined();
    expect(library.records.some((record) => record.collection === "builtin-markdown-slash")).toBe(false);
    expect(library.all.some((record) => record.collection === "builtin-markdown-slash")).toBe(true);
    expect(library.problems).toEqual([]);
  });

  it("starts with Fast math off and Paper structure on when there is no _state.json yet", async () => {
    const { useSnippetStore } = await loaded();
    const { library, state } = useSnippetStore.getState();
    expect(state.disabledCollections).toEqual(["fast-math-latex", "fast-math-typst"]);
    expect(library.byId("fm.fraction")).toBeUndefined();
    expect(library.byId("paper.figure")).toBeDefined();
    expect(mocks.writeSnippetFile).not.toHaveBeenCalled();
  });

  it("fetches the packs once and ignores index entries it can't trust", async () => {
    const { useSnippetStore } = await loaded();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/snippets/index.json",
      "/snippets/fast-math-latex.json",
      "/snippets/fast-math-typst.json",
      "/snippets/paper-structure.json",
    ]);
    put("mine.json", json(MINE));
    await useSnippetStore.getState().load();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(useSnippetStore.getState().library.byId("mine.fraction")).toBeDefined();

    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      text: async () => json([{ file: "../secret.json", collection: "x", defaultOn: true }, { file: "a.json", collection: "A", defaultOn: true }, "x"]),
    }));
    const again = await loaded();
    expect(again.useSnippetStore.getState().packs).toEqual({ files: [], defaultOff: [] });
  });

  it("logs a pack fetch that fails and tries again on the next load", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500, text: async () => "" }));
    const { useSnippetStore } = await loaded();
    expect(useSnippetStore.getState().packs).toBeNull();
    expect(useSnippetStore.getState().state.disabledCollections).toEqual([]);
    expect(mocks.logError).toHaveBeenCalledWith("load snippet packs", expect.any(Error));
    await useSnippetStore.getState().load();
    expect(useSnippetStore.getState().library.byId("paper.figure")).toBeDefined();
    expect(useSnippetStore.getState().state.disabledCollections).toEqual(["fast-math-latex", "fast-math-typst"]);
  });

  it("stays on the bundled snippets and refuses changes until the folder can be listed", async () => {
    put("mine.json", json(MINE));
    const denied = new Error("denied");
    mocks.listSnippetFiles.mockRejectedValueOnce(denied).mockRejectedValueOnce(denied);
    const { snippetsReady, useSnippetStore } = await fresh();
    await expect(useSnippetStore.getState().load()).rejects.toBe(denied);
    expect(useSnippetStore.getState().status).toBe("loading");
    expect(useSnippetStore.getState().library.byId("latex.slash.section")).toBeDefined();
    expect(useSnippetStore.getState().library.byId("mine.fraction")).toBeUndefined();
    expect(mocks.logError).toHaveBeenCalledWith("load snippets", denied);

    const added = userRecord("mine.root", { prefix: "sq", body: "\\sqrt{$1}" });
    await expect(useSnippetStore.getState().saveRecord("mine", added)).rejects.toThrow("denied");
    expect(mocks.writeSnippetFile).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));
    await snippetsReady();
    expect(useSnippetStore.getState().status).toBe("ready");
    await useSnippetStore.getState().saveRecord("mine", added);
    expect(Object.keys(JSON.parse(written("mine.json") ?? "{}"))).toEqual(["mine.fraction", "mine.root"]);
  });

  it("keeps what it has when a later listing fails", async () => {
    put("mine.json", json(MINE));
    const { useSnippetStore } = await loaded();
    const library = useSnippetStore.getState().library;
    mocks.listSnippetFiles.mockRejectedValueOnce(new Error("denied"));
    await expect(useSnippetStore.getState().load()).rejects.toThrow("denied");
    expect(useSnippetStore.getState().status).toBe("ready");
    expect(useSnippetStore.getState().library).toBe(library);
    expect(library.byId("mine.fraction")).toBeDefined();
  });

  it("rebuilds only when a file on disk changed", async () => {
    put("mine.json", json(MINE));
    const { useSnippetStore } = await loaded();
    const library = useSnippetStore.getState().library;
    await useSnippetStore.getState().load();
    expect(useSnippetStore.getState().library).toBe(library);
    put("mine.json", json(MINE));
    await useSnippetStore.getState().load();
    expect(useSnippetStore.getState().library).not.toBe(library);
  });

  it("shares one load between callers that ask at the same time", async () => {
    const { useSnippetStore } = await fresh();
    const first = useSnippetStore.getState().load();
    const second = useSnippetStore.getState().load();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(mocks.listSnippetFiles).toHaveBeenCalledTimes(1);
  });
});

describe("user files that go wrong", () => {
  it("keeps the last good set when a user file breaks, with the problem on its line", async () => {
    put("mine.json", json(MINE));
    const { useSnippetStore } = await loaded();
    put("mine.json", '{\n  "mine.fraction": {\n    "prefix": "ff",\n');
    await useSnippetStore.getState().load();
    const { library } = useSnippetStore.getState();
    expect(library.byId("mine.fraction")?.trigger).toBe("ff");
    expect(library.problems).toEqual([expect.objectContaining({ collection: "mine", code: "json", severity: "error" })]);

    put("mine.json", json({ "mine.other": { prefix: "oo", body: "x" } }));
    await useSnippetStore.getState().load();
    expect(useSnippetStore.getState().library.byId("mine.fraction")).toBeUndefined();
    expect(useSnippetStore.getState().library.byId("mine.other")).toBeDefined();
    expect(useSnippetStore.getState().library.problems).toEqual([]);
  });

  it("loads nothing from a file that was broken from the start and says why", async () => {
    put("broken.json", "[1, 2]");
    const { useSnippetStore } = await loaded();
    expect(useSnippetStore.getState().files.at(-1)).toMatchObject({ collection: "broken", records: [] });
    expect(useSnippetStore.getState().library.problems).toEqual([expect.objectContaining({ collection: "broken", code: "not-object" })]);
  });

  it("reports a file it could not read, keeping what it had", async () => {
    put("big.json", null, "larger than 2 MiB, not loaded");
    put("gone.json", null);
    const { useSnippetStore } = await loaded();
    expect(useSnippetStore.getState().library.problems).toEqual([
      expect.objectContaining({ collection: "big", code: "unreadable", message: "big.json could not be read. larger than 2 MiB, not loaded" }),
      expect.objectContaining({ collection: "gone", code: "unreadable", message: "gone.json could not be read." }),
    ]);

    put("big.json", json(MINE));
    await useSnippetStore.getState().load();
    put("big.json", null, "too big");
    await useSnippetStore.getState().load();
    expect(useSnippetStore.getState().library.byId("mine.fraction")).toBeDefined();
  });

  it("reports a file that makes the parser fail and still loads the others", async () => {
    put("deep.json", '{ "$overflow": {} }');
    put("mine.json", json(MINE));
    const { useSnippetStore } = await loaded();
    expect(useSnippetStore.getState().status).toBe("ready");
    expect(useSnippetStore.getState().library.byId("mine.fraction")).toBeDefined();
    expect(useSnippetStore.getState().library.problems).toEqual([
      expect.objectContaining({ collection: "deep", code: "unreadable", message: "deep.json could not be read. Maximum call stack size exceeded" }),
    ]);
    await expect(useSnippetStore.getState().saveRecord("deep", userRecord("deep.one", { prefix: "dd", body: "d" }))).rejects.toThrow(
      "deep.json has problems to fix before it can be changed here",
    );

    const parsed = await useSnippetStore.getState().importVsCodeFile("nested.code-snippets", '{ "$overflow": {} }');
    expect(parsed).toMatchObject({ collection: "nested", records: [], problems: [expect.objectContaining({ code: "unreadable" })] });
    expect(mocks.writeSnippetFile).not.toHaveBeenCalled();
  });

  it("refuses to rewrite a user file that has problems, so nothing in it is lost", async () => {
    put("mine.json", json({ ...MINE, "mine.bad": { prefix: "bb", body: "x", expand: "sometimes" } }));
    const { useSnippetStore } = await loaded();
    await expect(useSnippetStore.getState().saveRecord("mine", userRecord("mine.new", { prefix: "nn", body: "y" }))).rejects.toThrow(
      "mine.json has problems to fix before it can be changed here",
    );
    put("mine.json", null, "locked");
    await useSnippetStore.getState().load();
    await expect(useSnippetStore.getState().deleteRecord("mine", "mine.fraction")).rejects.toThrow("mine.json has problems");
    expect(mocks.writeSnippetFile).not.toHaveBeenCalled();
  });
});

describe("_state.json", () => {
  it("keeps the defaults and reports a broken file", async () => {
    put("_state.json", "{ nope");
    const { useSnippetStore } = await loaded();
    expect(useSnippetStore.getState().state.disabledCollections).toEqual(["fast-math-latex", "fast-math-typst"]);
    expect(useSnippetStore.getState().library.problems).toEqual([expect.objectContaining({ collection: "_state", code: "json", line: 1 })]);
    expect(useSnippetStore.getState().files.some((file) => file.collection === "_state")).toBe(false);
  });

  it("keeps the last good state when the file later breaks or can't be read", async () => {
    put("_state.json", json({ disabledCollections: ["paper-structure"], knownCollections: KNOWN }));
    const { useSnippetStore } = await loaded();
    put("_state.json", "[]");
    await useSnippetStore.getState().load();
    expect(useSnippetStore.getState().state.disabledCollections).toEqual(["paper-structure"]);
    expect(useSnippetStore.getState().stateProblems).toEqual([expect.objectContaining({ code: "not-object" })]);
    put("_state.json", null, "busy");
    await useSnippetStore.getState().load();
    expect(useSnippetStore.getState().state.disabledCollections).toEqual(["paper-structure"]);
    expect(useSnippetStore.getState().stateProblems).toEqual([expect.objectContaining({ code: "unreadable" })]);
  });

  it("drops the parts it can't use, each with a problem, and keeps the rest", async () => {
    const good = {
      id: "paper.figure",
      collection: "paper-structure",
      patch: {
        trigger: "figure",
        expand: "list",
        place: "any",
        inWord: true,
        lineStart: false,
        priority: 2,
        languages: ["latex"],
        name: "My figure",
        bodies: { latex: "\\begin{figure}$0\\end{figure}" },
      },
      disabled: false,
    };
    put(
      "_state.json",
      json({
        disabledCollections: "fast-math-latex",
        knownCollections: KNOWN,
        disabledRegex: [1],
        overrides: [
          good,
          { id: "paper.table", collection: "paper-structure", disabled: true },
          { id: "latex.slash.section", collection: "builtin-latex-slash", patch: { trigger: null } },
          "not an override",
          { id: 3, collection: "x" },
          { id: "a", collection: "b", patch: "x" },
          { id: "a", collection: "b", patch: { colour: "red" } },
          { id: "a", collection: "b", patch: { expand: "sometimes" } },
          { id: "a", collection: "b", patch: { priority: Number.NaN } },
          { id: "a", collection: "b", patch: { languages: [] } },
          { id: "a", collection: "b", patch: { bodies: "x" } },
          { id: "a", collection: "b", patch: { bodies: { klingon: "x" } } },
          { id: "a", collection: "b", patch: { bodies: { latex: 3 } } },
          { id: "a", collection: "b", patch: { bodies: { latex: "${1:" } } },
          { id: "a", collection: "b", disabled: "yes" },
        ],
      }),
    );
    const { useSnippetStore } = await loaded();
    const { state, library, stateProblems } = useSnippetStore.getState();
    expect(state.disabledCollections).toEqual([]);
    expect(state.disabledRegex).toEqual([]);
    expect(state.overrides.map((override) => override.id)).toEqual(["paper.figure", "paper.table", "latex.slash.section"]);
    expect(state.overrides[0]).not.toHaveProperty("disabled");
    expect(library.byId("paper.figure")).toMatchObject({ trigger: "figure", name: "My figure", priority: 2, inWord: true });
    expect(library.byId("paper.table")).toBeUndefined();
    expect(library.byId("latex.slash.section")?.trigger).toBeNull();
    expect(stateProblems.map((problem) => problem.message)).toEqual([
      ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((index) => `Change ${index} in overrides is not valid, so it was left out`),
      "disabledCollections is not a list of names, so it was left out",
      "disabledRegex is not a list of names, so it was left out",
    ]);
    expect(stateProblems.every((problem) => problem.line > 1)).toBe(true);
  });

  it("refuses to change the state while _state.json is broken or unreadable, so nothing in it is lost", async () => {
    put("_state.json", '{\n  "disabledCollections": ["paper-structure"],\n  "overrides": [\n');
    const { useSnippetStore } = await loaded();
    const refused = "_state.json has problems to fix before it can be changed here";
    await expect(useSnippetStore.getState().setCollectionEnabled("fast-math-latex", true)).rejects.toThrow(refused);
    await expect(useSnippetStore.getState().disableRegex("fm.subscript")).rejects.toThrow(refused);
    expect(useSnippetStore.getState().state.disabledCollections).toEqual(["fast-math-latex", "fast-math-typst"]);
    put("_state.json", null, "busy");
    await expect(useSnippetStore.getState().deleteRecord("builtin-latex-at", "at.alpha")).rejects.toThrow(refused);
    put("_state.json", "[]");
    await expect(useSnippetStore.getState().setOverride({ id: "at.alpha", collection: "builtin-latex-at", disabled: true })).rejects.toThrow(refused);
    expect(mocks.writeSnippetFile).not.toHaveBeenCalled();

    put("_state.json", json({ disabledCollections: ["paper-structure"], knownCollections: KNOWN, disabledRegex: 3 }));
    await useSnippetStore.getState().disableRegex("fm.subscript");
    expect(JSON.parse(written("_state.json") ?? "{}")).toMatchObject({ disabledCollections: ["paper-structure"], disabledRegex: ["fm.subscript"] });
  });

  it("keeps the captures in a changed body of a regex pack snippet", async () => {
    put(
      "_state.json",
      json({
        knownCollections: KNOWN,
        overrides: [{ id: "fm.subscript", collection: "fast-math-latex", patch: { bodies: { latex: "[[0]]_{[[1]]}" } } }],
      }),
    );
    const { useSnippetStore } = await loaded();
    expect(useSnippetStore.getState().library.byId("fm.subscript")?.bodies.latex).toEqual([
      { kind: "capture", group: 1 },
      { kind: "text", text: "_{" },
      { kind: "capture", group: 2 },
      { kind: "text", text: "}" },
    ]);
  });

  it("reports overrides that are not a list", async () => {
    put("_state.json", json({ overrides: {} }));
    const { useSnippetStore } = await loaded();
    expect(useSnippetStore.getState().stateProblems).toEqual([
      expect.objectContaining({ message: "overrides is not a list, so it was left out" }),
    ]);
  });
});

describe("changing snippets", () => {
  it("saves a user record into its collection file and reloads", async () => {
    put("mine.json", json({ $pack: { name: "Mine" }, ...MINE }));
    const { useSnippetStore } = await loaded();
    await useSnippetStore.getState().saveRecord("mine", userRecord("mine.root", { prefix: "sq", body: "\\sqrt{$1}" }));
    expect(JSON.parse(written("mine.json") ?? "{}")).toEqual({
      $pack: { name: "Mine" },
      "mine.fraction": { prefix: "ff", body: "\\frac{$1}{$2}", languages: ["latex"] },
      "mine.root": { prefix: "sq", body: "\\sqrt{$1}" },
    });
    expect(useSnippetStore.getState().library.byId("mine.root")?.trigger).toBe("sq");

    const edited = { ...userRecord("mine.fraction", { prefix: "fr", body: "\\frac{$1}{$2}" }), collection: "elsewhere" };
    await useSnippetStore.getState().saveRecord("mine", edited);
    expect(useSnippetStore.getState().library.byId("mine.fraction")).toMatchObject({ trigger: "fr", collection: "mine", layer: "user" });
    expect(Object.keys(JSON.parse(written("mine.json") ?? "{}"))).toEqual(["$pack", "mine.fraction", "mine.root"]);
  });

  it("creates a new collection file for a new collection", async () => {
    const { useSnippetStore } = await loaded();
    await useSnippetStore.getState().saveRecord("my-snippets", userRecord("my.one", { prefix: "one", body: "1" }));
    expect(JSON.parse(written("my-snippets.json") ?? "{}")).toEqual({ "my.one": { prefix: "one", body: "1" } });
    expect(useSnippetStore.getState().library.byId("my.one")?.collection).toBe("my-snippets");
  });

  it("stores a built-in or pack edit as an override, and clears it when the edit is undone", async () => {
    const { useSnippetStore } = await loaded();
    const original = useSnippetStore.getState().library.byId("paper.figure") as SnippetRecord;
    const bodies = { ...original.bodies, latex: parseSnippetFile(json({ x: { body: "\\begin{figure}$0\\end{figure}" } }), "x", "user").records[0].bodies.default };
    await useSnippetStore.getState().saveRecord("paper-structure", { ...original, trigger: "figure", bodies });
    expect(useSnippetStore.getState().state.overrides).toEqual([
      { id: "paper.figure", collection: "paper-structure", patch: { trigger: "figure", bodies } },
    ]);
    expect(JSON.parse(written("_state.json") ?? "{}").overrides).toEqual([
      {
        id: "paper.figure",
        collection: "paper-structure",
        patch: { trigger: "figure", bodies: { latex: "\\begin{figure}$0\\end{figure}", typst: expect.any(String) } },
      },
    ]);

    const reread = await loaded();
    expect(reread.useSnippetStore.getState().library.byId("paper.figure")).toMatchObject({ trigger: "figure", bodies });

    await reread.useSnippetStore.getState().saveRecord("paper-structure", original);
    expect(reread.useSnippetStore.getState().state.overrides).toEqual([]);
    expect(reread.useSnippetStore.getState().library.byId("paper.figure")?.trigger).toBe("fig");
  });

  it("keeps a turned-off built-in turned off when it is edited", async () => {
    const { useSnippetStore } = await loaded();
    await useSnippetStore.getState().deleteRecord("builtin-latex-slash", "latex.slash.section");
    const original = useSnippetStore.getState().library.all.find((record) => record.id === "latex.slash.section") as SnippetRecord;
    await useSnippetStore.getState().saveRecord("builtin-latex-slash", original);
    expect(useSnippetStore.getState().state.overrides).toEqual([{ id: "latex.slash.section", collection: "builtin-latex-slash", disabled: true }]);
    await useSnippetStore.getState().saveRecord("builtin-latex-slash", { ...original, trigger: "/s" });
    expect(useSnippetStore.getState().state.overrides).toEqual([
      { id: "latex.slash.section", collection: "builtin-latex-slash", patch: { trigger: "/s" }, disabled: true },
    ]);
    expect(useSnippetStore.getState().library.byId("latex.slash.section")).toBeUndefined();
  });

  it("refuses to add a new record to a built-in or pack collection", async () => {
    const { useSnippetStore } = await loaded();
    await expect(useSnippetStore.getState().saveRecord("paper-structure", userRecord("paper.new", { prefix: "pp", body: "x" }))).rejects.toThrow(
      "paper-structure is not a collection of your own snippets",
    );
  });

  it("deletes a user record from its file and turns a built-in one off", async () => {
    put("mine.json", json({ ...MINE, "mine.two": { prefix: "tw", body: "2" } }));
    const { useSnippetStore } = await loaded();
    await useSnippetStore.getState().deleteRecord("mine", "mine.fraction");
    expect(Object.keys(JSON.parse(written("mine.json") ?? "{}"))).toEqual(["mine.two"]);
    await useSnippetStore.getState().deleteRecord("builtin-latex-at", "at.alpha");
    expect(useSnippetStore.getState().state.overrides).toEqual([{ id: "at.alpha", collection: "builtin-latex-at", disabled: true }]);
    expect(useSnippetStore.getState().library.byId("at.alpha")).toBeUndefined();
  });

  it("turns collections on and off, writing only when something changes", async () => {
    const { useSnippetStore } = await loaded();
    await useSnippetStore.getState().setCollectionEnabled("fast-math-latex", true);
    expect(JSON.parse(written("_state.json") ?? "{}")).toEqual({
      disabledCollections: ["fast-math-typst"],
      knownCollections: KNOWN,
      disabledRegex: [],
      overrides: [],
    });
    expect(useSnippetStore.getState().library.byId("fm.fraction")).toBeDefined();
    await useSnippetStore.getState().setCollectionEnabled("fast-math-latex", true);
    expect(mocks.writeSnippetFile).toHaveBeenCalledTimes(1);
    await useSnippetStore.getState().setCollectionEnabled("paper-structure", false);
    expect(useSnippetStore.getState().state.disabledCollections).toEqual(["fast-math-typst", "paper-structure"]);
  });

  it("switches off a slow regular expression once", async () => {
    const { useSnippetStore } = await loaded();
    await useSnippetStore.getState().setCollectionEnabled("fast-math-latex", true);
    await useSnippetStore.getState().disableRegex("fm.subscript");
    await useSnippetStore.getState().disableRegex("fm.subscript");
    expect(useSnippetStore.getState().state.disabledRegex).toEqual(["fm.subscript"]);
    expect(useSnippetStore.getState().library.byId("fm.subscript")).toBeUndefined();
    expect(mocks.writeSnippetFile).toHaveBeenCalledTimes(2);
  });

  it("goes back to what is on disk when a write fails", async () => {
    const { useSnippetStore } = await loaded();
    mocks.writeSnippetFile.mockRejectedValueOnce(new Error("disk full"));
    await expect(useSnippetStore.getState().setCollectionEnabled("fast-math-latex", true)).rejects.toThrow("disk full");
    expect(useSnippetStore.getState().state.disabledCollections).toEqual(["fast-math-latex", "fast-math-typst"]);
  });

  it("loads first when a change arrives before anything was loaded", async () => {
    const { useSnippetStore } = await fresh();
    await useSnippetStore.getState().setOverride({ id: "at.alpha", collection: "builtin-latex-at", disabled: true });
    expect(useSnippetStore.getState().status).toBe("ready");
    expect(useSnippetStore.getState().library.byId("at.alpha")).toBeUndefined();
    await useSnippetStore.getState().setOverride({ id: "at.alpha", collection: "builtin-latex-at", clear: true });
    expect(useSnippetStore.getState().library.byId("at.alpha")).toBeDefined();
  });
});

describe("changes from more than one place", () => {
  it("reads the folder again before a change, so what another window saved is kept", async () => {
    put("mine.json", json(MINE));
    const { useSnippetStore } = await loaded();
    put("_state.json", json({ disabledCollections: ["fast-math-latex", "fast-math-typst", "paper-structure"], knownCollections: KNOWN }));
    put("mine.json", json({ ...MINE, "mine.other": { prefix: "oo", body: "o" } }));
    await useSnippetStore.getState().setCollectionEnabled("fast-math-latex", true);
    expect(JSON.parse(written("_state.json") ?? "{}").disabledCollections).toEqual(["fast-math-typst", "paper-structure"]);
    await useSnippetStore.getState().saveRecord("mine", userRecord("mine.root", { prefix: "sq", body: "\\sqrt{$1}" }));
    expect(Object.keys(JSON.parse(written("mine.json") ?? "{}"))).toEqual(["mine.fraction", "mine.other", "mine.root"]);
  });

  it("runs overlapping changes one after another, so none of them is lost", async () => {
    put("mine.json", json(MINE));
    const { useSnippetStore } = await loaded();
    const store = useSnippetStore.getState();
    await Promise.all([
      store.saveRecord("mine", userRecord("mine.a", { prefix: "aa", body: "a" })),
      store.saveRecord("mine", userRecord("mine.b", { prefix: "bb", body: "b" })),
      store.deleteRecord("mine", "mine.fraction"),
      store.setCollectionEnabled("paper-structure", false),
      store.disableRegex("fm.subscript"),
    ]);
    expect(Object.keys(JSON.parse(written("mine.json") ?? "{}"))).toEqual(["mine.a", "mine.b"]);
    expect(JSON.parse(written("_state.json") ?? "{}")).toMatchObject({
      disabledCollections: ["fast-math-latex", "fast-math-typst", "paper-structure"],
      disabledRegex: ["fm.subscript"],
    });
  });

  it("moves a switch at once, even while an earlier change is still being written", async () => {
    const { useSnippetStore } = await loaded();
    let finish: () => void = () => undefined;
    mocks.writeSnippetFile.mockImplementationOnce(
      (name, text) =>
        new Promise<void>((resolve) => {
          finish = () => {
            put(name, text);
            resolve();
          };
        }),
    );
    const disabled = () => useSnippetStore.getState().state.disabledCollections.includes("paper-structure");
    const off = useSnippetStore.getState().setCollectionEnabled("paper-structure", false);
    await vi.waitFor(() => expect(mocks.writeSnippetFile).toHaveBeenCalledOnce());
    expect(disabled()).toBe(true);
    const on = useSnippetStore.getState().setCollectionEnabled("paper-structure", true);
    await vi.waitFor(() => expect(disabled()).toBe(false));
    const offAgain = useSnippetStore.getState().setCollectionEnabled("paper-structure", false);
    await vi.waitFor(() => expect(disabled()).toBe(true));
    expect(mocks.writeSnippetFile).toHaveBeenCalledOnce();
    finish();
    await Promise.all([off, on, offAgain]);
    expect(mocks.writeSnippetFile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(written("_state.json") ?? "{}").disabledCollections).toContain("paper-structure");
    expect(disabled()).toBe(true);
  });

  it("keeps the library as it is when a reload finds nothing new", async () => {
    const { useSnippetStore } = await loaded();
    await useSnippetStore.getState().setCollectionEnabled("paper-structure", false);
    const library = useSnippetStore.getState().library;
    const engine = await import("./store-engine");
    await engine.load(true);
    expect(useSnippetStore.getState().library).toBe(library);
    expect(await useSnippetStore.getState().setCollectionEnabled("paper-structure", false)).toBeUndefined();
    expect(mocks.writeSnippetFile).toHaveBeenCalledOnce();
  });

  it("goes on with the next change after one fails", async () => {
    const { useSnippetStore } = await loaded();
    mocks.writeSnippetFile.mockRejectedValueOnce(new Error("disk full"));
    const failed = useSnippetStore.getState().setCollectionEnabled("paper-structure", false);
    const next = useSnippetStore.getState().disableRegex("fm.subscript");
    await expect(failed).rejects.toThrow("disk full");
    await next;
    expect(JSON.parse(written("_state.json") ?? "{}")).toMatchObject({ disabledCollections: ["fast-math-latex", "fast-math-typst"], disabledRegex: ["fm.subscript"] });
  });
});

describe("use counts", () => {
  it("counts uses in this browser only and never writes them to _state.json", async () => {
    localStorage.setItem("oleafly.snippets.uses", json({ "paper.figure": 2, bad: -1, worse: "x", half: 1.5 }));
    const { useSnippetStore } = await loaded();
    expect(useSnippetStore.getState().useCounts).toEqual({ "paper.figure": 2 });
    useSnippetStore.getState().recordUse("paper.figure");
    useSnippetStore.getState().recordUse("at.alpha");
    expect(useSnippetStore.getState().useCounts).toEqual({ "paper.figure": 3, "at.alpha": 1 });
    expect(JSON.parse(localStorage.getItem("oleafly.snippets.uses") ?? "{}")).toEqual({ "paper.figure": 3, "at.alpha": 1 });
    await useSnippetStore.getState().setCollectionEnabled("paper-structure", false);
    expect(written("_state.json")).not.toContain("paper.figure");
    expect(written("_state.json")).not.toMatch(/uses|count/u);
  });

  it("starts from nothing when the stored counts are unreadable or storage refuses", async () => {
    localStorage.setItem("oleafly.snippets.uses", "{");
    expect((await fresh()).useSnippetStore.getState().useCounts).toEqual({});
    localStorage.setItem("oleafly.snippets.uses", "[1]");
    const { useSnippetStore } = await fresh();
    expect(useSnippetStore.getState().useCounts).toEqual({});
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    useSnippetStore.getState().recordUse("x");
    expect(useSnippetStore.getState().useCounts).toEqual({ x: 1 });
    setItem.mockRestore();
  });
});

describe("importing a VS Code snippet file", () => {
  const VS_CODE = '// Place your snippets here\n{\n  "Fraction": {\n    "prefix": "frac",\n    "body": ["\\\\frac{$1}{$2}"],\n    "scope": "latex",\n  },\n}\n';

  it("writes a new user collection named after the file, never reusing a name", async () => {
    const { useSnippetStore } = await loaded();
    const parsed = await useSnippetStore.getState().importVsCodeFile("/home/me/latex.code-snippets", VS_CODE);
    expect(parsed).toMatchObject({ collection: "latex", records: [{ id: "Fraction", trigger: "frac", languages: ["latex"] }] });
    expect(written("latex.json")).toBe(VS_CODE);
    expect(useSnippetStore.getState().library.byId("Fraction")?.collection).toBe("latex");

    expect((await useSnippetStore.getState().importVsCodeFile("LATEX.json", VS_CODE)).collection).toBe("LATEX-2");
    expect((await useSnippetStore.getState().importVsCodeFile("paper-structure.json", VS_CODE)).collection).toBe("paper-structure-2");
    expect((await useSnippetStore.getState().importVsCodeFile("C:\\Users\\me\\..My Snips!.json", VS_CODE)).collection).toBe("My Snips-");
    expect((await useSnippetStore.getState().importVsCodeFile("con.json", VS_CODE)).collection).toBe("con-snippets");
    expect((await useSnippetStore.getState().importVsCodeFile("Ünïcode ✓ ..json", VS_CODE)).collection).toBe("Unicode -");
    expect((await useSnippetStore.getState().importVsCodeFile("✓.json", VS_CODE)).collection).toBe("imported");
  });

  it("writes nothing for a file with no snippets in it", async () => {
    const { useSnippetStore } = await loaded();
    const parsed = await useSnippetStore.getState().importVsCodeFile("empty.json", "{ oops");
    expect(parsed.problems).toEqual([expect.objectContaining({ code: "json" })]);
    expect(mocks.writeSnippetFile).not.toHaveBeenCalled();
  });
});

describe("packs added after the state was saved", () => {
  it("starts a pack that is off by default as off when the saved state has not seen it", async () => {
    put("_state.json", json({ disabledCollections: [], knownCollections: ["paper-structure"] }));
    const { useSnippetStore } = await loaded();
    expect(useSnippetStore.getState().state.disabledCollections).toEqual(["fast-math-latex", "fast-math-typst"]);
  });

  it("keeps a known pack the user turned on, and records every pack it knows on the next write", async () => {
    put("_state.json", json({ disabledCollections: ["fast-math-typst"], knownCollections: KNOWN }));
    const { useSnippetStore } = await loaded();
    expect(useSnippetStore.getState().state.disabledCollections).toEqual(["fast-math-typst"]);
    await useSnippetStore.getState().setCollectionEnabled("paper-structure", false);
    expect(JSON.parse(written("_state.json") ?? "{}").knownCollections).toEqual(KNOWN);
  });
});

describe("settings export and import", () => {
  it("hands over every readable user file and _state.json, as they are on disk", async () => {
    put("mine.json", json(MINE));
    put("_state.json", json({ disabledCollections: [] }));
    put("big.json", null, "too big");
    const { snippetSettingsFiles } = await loaded();
    expect(snippetSettingsFiles()).toEqual([
      { name: "_state.json", text: json({ disabledCollections: [] }) },
      { name: "mine.json", text: json(MINE) },
    ]);
  });

  it("writes imported files, reusing the spelling of a file already there, then reloads", async () => {
    put("Mine.json", json({}));
    const { importSnippetSettingsFiles, useSnippetStore } = await loaded();
    await importSnippetSettingsFiles([
      { name: "mine.json", text: json(MINE) },
      { name: "_state.json", text: json({ disabledCollections: ["paper-structure"], knownCollections: KNOWN }) },
    ]);
    expect(mocks.writeSnippetFile.mock.calls.map(([name]) => name)).toEqual(["Mine.json", "_state.json"]);
    expect(useSnippetStore.getState().library.byId("mine.fraction")).toBeDefined();
    expect(useSnippetStore.getState().state.disabledCollections).toEqual(["paper-structure"]);
  });

  it("writes nothing when the imported files match the ones already there", async () => {
    put("mine.json", json(MINE));
    const { importSnippetSettingsFiles } = await loaded();
    await importSnippetSettingsFiles([{ name: "MINE.json", text: json(MINE) }]);
    expect(mocks.writeSnippetFile).not.toHaveBeenCalled();
  });

  it.each([
    ["mine.json", true],
    ["_state.json", true],
    ["My snippets 2.json", true],
    [`${"a".repeat(64)}.json`, true],
    [`${"a".repeat(65)}.json`, false],
    ["_other.json", false],
    ["-x.json", false],
    ["x.txt", false],
    ["../x.json", false],
    ["a/b.json", false],
    ["trailing .json", false],
    ["dot..json", false],
    ["CON.json", false],
    ["lpt1.json", false],
    ["é.json", false],
  ])("%s is a snippet file name: %s", async (name, valid) => {
    const { validSnippetFileName } = await fresh();
    expect(validSnippetFileName(name)).toBe(valid);
  });
});

describe("reloading on focus", () => {
  it("reads the folder again when the window comes back, once anything loaded the snippets", async () => {
    const { useSnippetStore } = await fresh();
    window.dispatchEvent(new Event("focus"));
    expect(mocks.listSnippetFiles).not.toHaveBeenCalled();
    await useSnippetStore.getState().setCollectionEnabled("paper-structure", false);
    await useSnippetStore.getState().load();
    expect(focusListeners()).toHaveLength(1);
    put("mine.json", json(MINE));
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(useSnippetStore.getState().library.byId("mine.fraction")).toBeDefined());
  });
});
