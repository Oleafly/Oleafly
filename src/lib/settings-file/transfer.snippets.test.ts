// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, SnippetFileEntry } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  listSnippetFiles: vi.fn<() => Promise<SnippetFileEntry[]>>(),
  writeSnippetFile: vi.fn<(name: string, text: string) => Promise<void>>(),
}));

vi.mock("@/lib/tauri", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
  listSnippetFiles: mocks.listSnippetFiles,
  writeSnippetFile: mocks.writeSnippetFile,
}));

vi.mock("@/i18n/desktop", () => ({
  changeLocalePreference: vi.fn(async () => undefined),
}));

import { useSnippetStore } from "@/features/snippets/store";
import { useSettingsStore } from "@/store/settings";
import {
  applySettingsPlan,
  buildSettingsDocument,
  captureSettingsSnapshot,
  readSettingsFile,
  serializeSettingsDocument,
  watchSettingsSources,
} from "./transfer";

const THEME = { preference: "system" as const, setPreference: vi.fn() };
const initial = { snippets: useSnippetStore.getState(), settings: useSettingsStore.getState() };
const disk = new Map<string, string | null>();
let clock = 0;
const MINE = '{\n  // my own\n  "mine.fraction": { "prefix": "ff", "body": "\\\\frac{$1}{$2}" }\n}\n';
const STATE = '{\n  "disabledCollections": [],\n  "disabledRegex": [],\n  "overrides": []\n}\n';

function baseConfig(): AppConfig {
  return {
    github_token: "",
    github_user: "",
    github_connected: false,
    ai_api_key: "",
    ai_provider: "openai",
    ai_model: "gpt-4o-mini",
    ai_keys: {},
    ai_system_prompt: "",
    ai_pdf_capture: true,
    ai_provider_models: {},
    ai_custom_providers: [],
    ai_personas: [],
    ai_starter_personas_seeded: true,
    checkpoints_enabled: true,
    checkpoint_notifications: true,
    git_auto_init: true,
    mcp_enabled: false,
    mcp_port: 5323,
    mcp_read_only: false,
    mcp_approval_policy: "ask",
    mcp_servers: [],
  };
}

function snapshot() {
  return captureSettingsSnapshot("system");
}

function problemsOf(files: unknown, current: Awaited<ReturnType<typeof snapshot>>) {
  const read = readSettingsFile(JSON.stringify({ snippets: { files } }), current);
  return read.ok || read.reason !== "invalid" ? [] : read.problems;
}

beforeEach(() => {
  localStorage.clear();
  disk.clear();
  useSnippetStore.setState(initial.snippets, true);
  useSettingsStore.setState(initial.settings, true);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, text: async () => "" })));
  mocks.getConfig.mockResolvedValue(baseConfig());
  mocks.setConfig.mockResolvedValue(undefined);
  mocks.listSnippetFiles.mockImplementation(async () =>
    [...disk.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([name, text]) => ({ name, text, error: text === null ? "busy" : null, modifiedMs: clock })),
  );
  mocks.writeSnippetFile.mockImplementation(async (name, text) => {
    clock += 1;
    disk.set(name, text);
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("snippets in a settings file", () => {
  it("exports the four switches, each user file and _state.json as they are on disk, and no use counts", async () => {
    disk.set("mine.json", MINE);
    disk.set("_state.json", STATE);
    disk.set("locked.json", null);
    useSettingsStore.getState().setSnippetsAuto(false);
    await useSnippetStore.getState().load();
    useSnippetStore.getState().recordUse("mine.fraction");
    const document = buildSettingsDocument(await snapshot());
    expect(document.snippets).toEqual({
      list: true,
      tab: true,
      auto: false,
      hint: true,
      files: [
        { name: "_state.json", text: STATE },
        { name: "mine.json", text: MINE },
      ],
    });
    const text = serializeSettingsDocument(document);
    expect(text).not.toContain("oleafly.snippets.uses");
    expect(readSettingsFile(text, await snapshot())).toMatchObject({ ok: true, changed: [], ignored: [] });
  });

  it("loads the snippet files before it takes a snapshot", async () => {
    disk.set("mine.json", MINE);
    expect(useSnippetStore.getState().status).toBe("idle");
    expect((await snapshot()).snippetFiles).toEqual([{ name: "mine.json", text: MINE }]);
  });

  it("writes imported files through the snippets folder and reloads them", async () => {
    const read = readSettingsFile(
      JSON.stringify({ snippets: { hint: false, files: [{ name: "mine.json", text: MINE }, { name: "_state.json", text: STATE }] } }),
      await snapshot(),
    );
    if (!read.ok) throw new Error(read.reason);
    expect(read.changed).toEqual(["snippets.hint", "snippets.files"]);
    await applySettingsPlan(read.plan, THEME);
    expect(mocks.writeSnippetFile.mock.calls).toEqual([
      ["mine.json", MINE],
      ["_state.json", STATE],
    ]);
    expect(useSnippetStore.getState().library.byId("mine.fraction")?.trigger).toBe("ff");
    expect(useSettingsStore.getState().snippetsHint).toBe(false);
    expect(localStorage.getItem("oleafly.snippets.hint")).toBe("0");
  });

  it("writes nothing when the file lists no snippet files", async () => {
    const read = readSettingsFile(JSON.stringify({ snippets: { files: [] } }), await snapshot());
    if (!read.ok) throw new Error(read.reason);
    await applySettingsPlan(read.plan, THEME);
    expect(mocks.writeSnippetFile).not.toHaveBeenCalled();
  });

  it("refuses a file name the snippets folder can't hold, saying what a name may be", async () => {
    const current = await snapshot();
    for (const name of ["../x.json", "a/b.json", "x.txt", "CON.json", "_other.json", 3]) {
      expect(problemsOf([{ name, text: "{}" }], current)).toEqual([
        { path: "snippets.files[0].name", issue: { kind: "snippetFileName" } },
      ]);
    }
  });

  it("refuses snippet file entries that are not plain name and text pairs", async () => {
    const current = await snapshot();
    expect(problemsOf("mine.json", current)).toEqual([{ path: "snippets.files", issue: { kind: "list", max: 200 } }]);
    expect(problemsOf(Array.from({ length: 201 }, () => ({})), current)).toEqual([
      { path: "snippets.files", issue: { kind: "list", max: 200 } },
    ]);
    expect(problemsOf(["mine.json"], current)).toEqual([{ path: "snippets.files[0]", issue: { kind: "object" } }]);
    expect(problemsOf([{ name: "a.json", text: "{}", size: 2 }], current)).toEqual([
      { path: "snippets.files[0].size", issue: { kind: "unknownKey" } },
    ]);
    expect(problemsOf([{ name: "a.json", text: 2 }], current)).toEqual([
      { path: "snippets.files[0].text", issue: { kind: "text", max: 2 * 1024 * 1024 } },
    ]);
    expect(problemsOf([{ name: "a.json", text: "{}" }, { name: "A.json", text: "{}" }], current)).toEqual([
      { path: "snippets.files[1].name", issue: { kind: "duplicate" } },
    ]);
  });

  it("wakes the settings view when the snippet files change on disk", async () => {
    await useSnippetStore.getState().load();
    const listener = vi.fn();
    const stop = watchSettingsSources(listener);
    useSnippetStore.getState().recordUse("x");
    expect(listener).not.toHaveBeenCalled();
    disk.set("mine.json", MINE);
    await useSnippetStore.getState().load();
    expect(listener).toHaveBeenCalledOnce();
    stop();
  });
});
