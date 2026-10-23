// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  changeLocalePreference: vi.fn(async () => undefined),
}));

vi.mock("@/lib/tauri", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}));

vi.mock("@/i18n/desktop", () => ({
  changeLocalePreference: mocks.changeLocalePreference,
}));

import { useDictionary } from "@/lib/dictionary";
import { readThemeCustomization } from "@/lib/theme-customization";
import { useCompileStore } from "@/store/compile";
import { useEditorKeymapStore } from "@/store/editor-keymap";
import { TERMINAL_COLOR_THEMES, useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import { defaultShortcutBinding } from "./apply";
import { SETTINGS_FIELDS, formatShortcut, parseShortcut, type ConfigPreferences } from "./schema";
import {
  applySettingsPlan,
  buildSettingsDocument,
  captureSettingsSnapshot,
  readLocalSnapshot,
  readSettingsFile,
  serializeSettingsDocument,
  watchSettingsSources,
} from "./transfer";
import { bool } from "./values";

const initial = {
  settings: useSettingsStore.getState(),
  shortcuts: useShortcutStore.getState(),
  editorKeys: useEditorKeymapStore.getState(),
  dictionary: useDictionary.getState(),
  compile: useCompileStore.getState(),
};

const THEME = { preference: "system" as const, setPreference: vi.fn() };

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    github_token: "",
    github_user: "",
    github_connected: false,
    ai_api_key: "secret-should-never-leave",
    ai_provider: "openai",
    ai_model: "gpt-4o-mini",
    ai_keys: { openai: "sk-never" },
    ai_system_prompt: "Be brief.",
    ai_pdf_capture: true,
    ai_provider_models: {},
    ai_custom_providers: [],
    ai_personas: [{ id: "editor", name: "Editor", color: "ocean", prompt: "Edit for clarity." }],
    ai_starter_personas_seeded: true,
    checkpoints_enabled: true,
    checkpoint_notifications: true,
    git_auto_init: true,
    mcp_enabled: false,
    mcp_port: 5323,
    mcp_read_only: false,
    mcp_approval_policy: "ask",
    mcp_servers: [],
    ...overrides,
  };
}

function configPreferences(config: AppConfig): ConfigPreferences {
  return {
    ai_system_prompt: config.ai_system_prompt,
    ai_pdf_capture: config.ai_pdf_capture,
    ai_reasoning_summaries: config.ai_reasoning_summaries === true,
    ai_personas: config.ai_personas,
    checkpoints_enabled: config.checkpoints_enabled,
    checkpoint_notifications: config.checkpoint_notifications,
    research_keep_awake: config.research_keep_awake !== false,
    research_notifications: config.research_notifications !== false,
    research_command_network: config.research_command_network === true,
    research_time_budget_minutes: config.research_time_budget_minutes ?? 120,
  };
}

function fileWith(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

function snapshot() {
  return readLocalSnapshot(configPreferences(baseConfig()), "system");
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState(initial.settings, true);
  useShortcutStore.setState(initial.shortcuts, true);
  useEditorKeymapStore.setState(initial.editorKeys, true);
  useDictionary.setState(initial.dictionary, true);
  useCompileStore.setState(initial.compile, true);
  mocks.getConfig.mockResolvedValue(baseConfig());
  mocks.setConfig.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("toggle values", () => {
  it.each([true, 1, "on"])("reads %j as on", (raw) => {
    expect(bool.parse(raw)).toEqual({ ok: true, value: true });
  });

  it.each([false, 0, "off"])("reads %j as off", (raw) => {
    expect(bool.parse(raw)).toEqual({ ok: true, value: false });
  });

  it.each(["true", "yes", 2, -1, null, "", [], {}])("refuses %j", (raw) => {
    expect(bool.parse(raw).ok).toBe(false);
  });
});

describe("settings document", () => {
  it("nests every setting under its settings section and never carries secrets", () => {
    const document = buildSettingsDocument(snapshot());
    expect(Object.keys(document)).toEqual([
      "general",
      "appearance",
      "dictionary",
      "data",
      "ai",
      "research",
      "engine",
      "shortcuts",
      "experimentation",
    ]);
    expect(Object.keys(document.appearance as object)).toEqual(["app", "editor", "terminal", "pdf", "files"]);
    const text = serializeSettingsDocument(document);
    expect(text).toContain('\n  "general": {\n    "language": "system",');
    expect(text).toContain('"fontSize": 16');
    expect(text).toContain('"fontSize": 13');
    expect(text).toContain('"fontSize": 14');
    expect(text).not.toContain("secret-should-never-leave");
    expect(text).not.toContain("sk-never");
    expect(text).not.toContain("gpt-4o-mini");
    expect(text).not.toContain("mcp");
  });

  it("writes a file that imports back with nothing to change", () => {
    const text = serializeSettingsDocument(buildSettingsDocument(snapshot()));
    const read = readSettingsFile(text, snapshot());
    expect(read).toMatchObject({ ok: true, changed: [], ignored: [] });
  });

  it("keeps customized values the Settings window can set, and they import back unchanged", () => {
    useSettingsStore.getState().setEditorFontSize(13.5);
    useSettingsStore.getState().setHarperEnabledRules(["SpellCheck", "LongSentences"]);
    useShortcutStore.getState().setBinding("commandPalette", { key: " ", mod: true, shift: true });
    useEditorKeymapStore.getState().setKey("titleCase", "Mod-Alt-t");
    const text = serializeSettingsDocument(buildSettingsDocument(snapshot()));
    expect(JSON.parse(text)).toMatchObject({
      appearance: { editor: { fontSize: 13.5 } },
      dictionary: { enabledGrammarRules: ["LongSentences", "SpellCheck"] },
      shortcuts: { app: { commandPalette: "Mod-Shift-Space" }, editor: { titleCase: "Mod-Alt-t" } },
    });
    expect(readSettingsFile(text, snapshot())).toMatchObject({ ok: true, changed: [], ignored: [] });
  });

  it("reads a file saved with a byte order mark", () => {
    const text = String.fromCodePoint(0xfeff) + fileWith({ appearance: { editor: { fontSize: 18 } } });
    expect(readSettingsFile(text, snapshot())).toMatchObject({ ok: true, changed: ["appearance.editor.fontSize"] });
  });

  it("wakes the live view only when a value the file holds changes", () => {
    const listener = vi.fn();
    const stop = watchSettingsSources(listener);
    useCompileStore.setState({});
    useSettingsStore.getState().setPaletteOpen(true);
    useShortcutStore.setState({});
    expect(listener).not.toHaveBeenCalled();
    useCompileStore.setState({ stopOnFirstError: !useCompileStore.getState().stopOnFirstError });
    useSettingsStore.getState().setEditorFontSize(18);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    useSettingsStore.getState().setEditorFontSize(19);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("covers every field in the export", () => {
    const text = serializeSettingsDocument(buildSettingsDocument(snapshot()));
    const read = readSettingsFile(text, snapshot());
    if (!read.ok) throw new Error(read.reason);
    const exported = new Set<string>();
    const visit = (node: Record<string, unknown>, prefix: string) => {
      for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (SETTINGS_FIELDS.some((setting) => setting.path === path)) exported.add(path);
        else if (value && typeof value === "object" && !Array.isArray(value)) visit(value as Record<string, unknown>, path);
      }
    };
    visit(JSON.parse(text) as Record<string, unknown>, "");
    expect([...exported].sort()).toEqual(SETTINGS_FIELDS.map((setting) => setting.path).sort());
  });

  it("leaves AI and checkpoint settings out when the config can't be read", () => {
    const document = buildSettingsDocument(readLocalSnapshot(null, "system"));
    expect(document.ai).toBeUndefined();
    expect(document.data).toBeUndefined();
  });

  it("captures the config through the bridge", async () => {
    const captured = await captureSettingsSnapshot("dark");
    expect(captured.theme).toBe("dark");
    expect(captured.config?.ai_system_prompt).toBe("Be brief.");
    mocks.getConfig.mockRejectedValueOnce(new Error("no bridge"));
    expect((await captureSettingsSnapshot("system")).config).toBeNull();
  });
});

describe("reading a settings file", () => {
  it("refuses text that isn't JSON or isn't a settings file", () => {
    expect(readSettingsFile("{", snapshot())).toEqual({ ok: false, reason: "notJson" });
    expect(readSettingsFile("[]", snapshot())).toEqual({ ok: false, reason: "notSettings" });
    expect(readSettingsFile("{}", snapshot())).toEqual({ ok: false, reason: "notSettings" });
    expect(readSettingsFile('"general"', snapshot())).toEqual({ ok: false, reason: "notSettings" });
    expect(readSettingsFile('{"name":"thesis","version":2}', snapshot())).toEqual({
      ok: false,
      reason: "notSettings",
    });
    expect(readSettingsFile('{"general":{}}', snapshot())).toMatchObject({ ok: true, changed: [] });
  });

  it("lists every value outside its schema and applies nothing", () => {
    const read = readSettingsFile(
      fileWith({
        general: { spellcheck: "yes", language: "klingon" },
        appearance: {
          app: { fontSize: 15, zoom: 133, accentColor: "blue" },
          editor: { fontSize: 1000, tabSize: 3, colors: { dracula: { background: "red", sparkle: "#000000" } } },
          terminal: { fontWeight: 450 },
          files: "grid",
        },
        dictionary: { words: ["ok", "ok"] },
        ai: { personas: [{ name: "Tutor", color: "neon", prompt: "Help." }] },
        shortcuts: { app: { recompile: "Shift-a" }, editor: { uppercase: "Hyper-u" } },
      }),
      snapshot(),
    );
    expect(read.ok).toBe(false);
    if (read.ok || read.reason !== "invalid") throw new Error("expected problems");
    expect(read.problems).toEqual([
      { path: "general.spellcheck", issue: { kind: "boolean" } },
      { path: "general.language", issue: expect.objectContaining({ kind: "oneOf" }) },
      { path: "appearance.app.zoom", issue: expect.objectContaining({ kind: "oneOf" }) },
      { path: "appearance.app.accentColor", issue: { kind: "hexColor" } },
      { path: "appearance.editor.fontSize", issue: { kind: "range", min: 6, max: 100 } },
      { path: "appearance.editor.tabSize", issue: { kind: "oneOf", values: [2, 4, 8] } },
      { path: "appearance.editor.colors.dracula.background", issue: { kind: "hexColor" } },
      { path: "appearance.terminal.fontWeight", issue: { kind: "wholeRange", min: 100, max: 900, step: 100 } },
      { path: "appearance.files", issue: { kind: "object" } },
      { path: "dictionary.words[1]", issue: { kind: "duplicate" } },
      { path: "ai.personas[0].color", issue: expect.objectContaining({ kind: "oneOf" }) },
      { path: "shortcuts.app.recompile", issue: { kind: "shortcut" } },
      { path: "shortcuts.editor.uppercase", issue: { kind: "editorKey" } },
    ]);
  });

  it("keeps the composer height, a panel size, out of the settings file", () => {
    useSettingsStore.getState().setAiComposerHeight(300);
    expect(JSON.stringify(buildSettingsDocument(snapshot()))).not.toMatch(/composerHeight|"assistant"/);
    const read = readSettingsFile(fileWith({ appearance: { assistant: { composerHeight: 400 } } }), snapshot());
    expect(read).toMatchObject({ ok: true, changed: [], ignored: ["appearance.assistant"] });
    expect(useSettingsStore.getState().aiComposerHeight).toBe(300);
  });

  it("round-trips the reasoning summaries setting in a settings file", () => {
    const read = readSettingsFile(fileWith({ ai: { reasoningSummaries: true } }), snapshot());
    expect(read).toMatchObject({ ok: true, changed: ["ai.reasoningSummaries"] });
  });

  it("imports a settings file without the composer height", () => {
    const read = readSettingsFile(fileWith({ appearance: { editor: { fontSize: 18 } } }), snapshot());
    expect(read).toMatchObject({ ok: true, changed: ["appearance.editor.fontSize"] });
    expect(useSettingsStore.getState().aiComposerHeight).toBe(56);
  });

  it("imports a 0.4.7 file without the new keys", () => {
    const read = readSettingsFile(fileWith({ appearance: { terminal: { fontSize: 15 } } }), snapshot());
    expect(read).toMatchObject({ ok: true, changed: ["appearance.terminal.fontSize"] });
    expect(useSettingsStore.getState()).toMatchObject({
      terminalShell: "auto",
      terminalShiftEnter: "newline",
      terminalScrollback: 5000,
      terminalConfirmClose: true,
    });
  });

  it("round-trips the terminal behavior settings", () => {
    const read = readSettingsFile(
      fileWith({
        appearance: {
          terminal: {
            shell: "gitBash",
            shellPath: "C:\\msys64\\usr\\bin\\zsh.exe",
            shiftEnter: "enter",
            copyOnSelect: true,
            optionIsMeta: true,
            scrollback: 25000,
            confirmClose: false,
          },
        },
      }),
      snapshot(),
    );
    expect(read).toMatchObject({
      ok: true,
      changed: [
        "appearance.terminal.shell",
        "appearance.terminal.shellPath",
        "appearance.terminal.shiftEnter",
        "appearance.terminal.copyOnSelect",
        "appearance.terminal.optionIsMeta",
        "appearance.terminal.scrollback",
        "appearance.terminal.confirmClose",
      ],
    });
  });

  it("refuses an unknown shell id and a scrollback outside the list", () => {
    const read = readSettingsFile(
      fileWith({ appearance: { terminal: { shell: "fish", scrollback: 7000, shiftEnter: "newline" } } }),
      snapshot(),
    );
    expect(read.ok).toBe(false);
    if (read.ok || read.reason !== "invalid") throw new Error("expected problems");
    expect(read.problems).toEqual([
      { path: "appearance.terminal.shell", issue: expect.objectContaining({ kind: "oneOf" }) },
      { path: "appearance.terminal.scrollback", issue: expect.objectContaining({ kind: "oneOf" }) },
    ]);
  });

  it("reads a 0.4.7 settings file that still has the browser settings", () => {
    const read = readSettingsFile(
      fileWith({
        appearance: { browser: { homePage: "https://example.org/", searchEngine: "bing" }, pdf: { darkMode: true } },
        experimentation: { webBrowser: true, latexTools: true },
        shortcuts: { app: { toggleBrowser: "Ctrl-Shift-b", commandPalette: "Mod-p" } },
      }),
      snapshot(),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.ignored).toEqual([]);
    expect(read.changed).toEqual(
      expect.arrayContaining(["appearance.pdf.darkMode", "experimentation.latexTools", "shortcuts.app.commandPalette"]),
    );
  });

  it("still reports keys it doesn't know", () => {
    const read = readSettingsFile(fileWith({ appearance: { pdf: { darkMode: true }, whatever: 1 } }), snapshot());
    expect(read.ok && read.ignored).toEqual(["appearance.whatever"]);
  });

  it("writes no browser settings", () => {
    const document = buildSettingsDocument(snapshot());
    expect(JSON.stringify(document)).not.toMatch(/webBrowser|browser\.homePage|searchEngine|toggleBrowser/);
  });

  it("skips entries it doesn't know and reports them", () => {
    const read = readSettingsFile(
      fileWith({
        appearance: { editor: { fontSize: 18, fontSzie: 20 }, sidebar: {} },
        integrations: { github: { token: "x" } },
      }),
      snapshot(),
    );
    expect(read).toMatchObject({
      ok: true,
      changed: ["appearance.editor.fontSize"],
      ignored: ["appearance.editor.fontSzie", "appearance.sidebar", "integrations"],
    });
  });

  it("checks persona fields one by one", () => {
    const personas = (value: unknown) =>
      readSettingsFile(fileWith({ ai: { personas: value } }), snapshot());
    expect(personas([{ id: "a", name: " ", color: "ocean", prompt: "x" }])).toMatchObject({
      problems: [{ path: "ai.personas[0].name" }],
    });
    expect(personas([{ id: "a", name: "A", color: "ocean", prompt: "x", extra: 1 }])).toMatchObject({
      problems: [{ path: "ai.personas[0].extra", issue: { kind: "unknownKey" } }],
    });
    expect(
      personas([
        { id: "a", name: "A", color: "ocean", prompt: "x" },
        { id: "a", name: "B", color: "grape", prompt: "y" },
      ]),
    ).toMatchObject({ problems: [{ path: "ai.personas[1].id", issue: { kind: "duplicate" } }] });
    expect(personas([{ id: "p", name: "Pasted", color: "slate", prompt: "From Word\vwith a vertical tab" }])).toMatchObject({
      ok: true,
    });
    expect(personas([{ id: "p", name: "Nul", color: "slate", prompt: "a\u0000b" }])).toMatchObject({
      problems: [{ path: "ai.personas[0].prompt", issue: { kind: "text" } }],
    });
    const read = personas([{ name: "Tutor", color: "forest", prompt: "Line one\nLine two" }]);
    if (!read.ok) throw new Error("expected a valid persona");
    expect(read.plan.config.ai_personas?.[0]).toMatchObject({ name: "Tutor", prompt: "Line one\nLine two" });
  });

  it("refuses shortcuts the operating system keeps for itself", () => {
    const read = readSettingsFile(
      fileWith({ shortcuts: { app: { recompile: "Ctrl-v" }, editor: { uppercase: "Mod-a" } } }),
      snapshot(),
    );
    expect(read).toMatchObject({
      ok: false,
      problems: [
        { path: "shortcuts.app.recompile", issue: { kind: "reservedShortcut", action: "paste" } },
        { path: "shortcuts.editor.uppercase", issue: { kind: "reservedShortcut", action: "selectAll" } },
      ],
    });
  });

  it("counts grammar rules listed in another order as unchanged", () => {
    useSettingsStore.getState().setHarperEnabledRules(["LongSentences", "SpellCheck"]);
    const read = readSettingsFile(
      fileWith({ dictionary: { enabledGrammarRules: ["SpellCheck", "LongSentences"] } }),
      snapshot(),
    );
    expect(read).toMatchObject({ ok: true, changed: [] });
  });

  it("treats words that differ only in case as duplicates", () => {
    expect(readSettingsFile(fileWith({ dictionary: { words: ["Oleafly", "oleafly"] } }), snapshot())).toMatchObject({
      problems: [{ path: "dictionary.words[1]", issue: { kind: "duplicate" } }],
    });
  });

  it("refuses a custom theme with unsafe CSS", () => {
    const read = readSettingsFile(
      fileWith({ appearance: { app: { customTheme: { light: {}, dark: {}, customCss: "background: url(x)" } } } }),
      snapshot(),
    );
    expect(read).toMatchObject({ ok: false, problems: [{ path: "appearance.app.customTheme", issue: { kind: "detail" } }] });
  });
});

describe("shortcut text", () => {
  it.each([
    [{ key: "Enter", mod: true }, "Mod-Enter"],
    [{ key: "f", mod: true, shift: true }, "Mod-Shift-f"],
    [{ key: "-", mod: true }, "Mod--"],
    [{ key: "`", ctrl: true }, "Ctrl-`"],
    [{ key: "F11", shift: true }, "Shift-F11"],
    [{ key: "b", ctrl: true, alt: true }, "Ctrl-Alt-b"],
    [{ key: " ", mod: true, shift: true }, "Mod-Shift-Space"],
  ])("writes %j as %s and reads it back", (binding, text) => {
    expect(formatShortcut(binding)).toBe(text);
    expect(parseShortcut(text)).toEqual(binding);
  });

  it.each(["Shift-a", "a", "Hyper-k", "Mod-Mod-k", "Ctrl-", "", "Mod-constructor-k", "__proto__-Mod-k"])("refuses %j", (text) => {
    expect(parseShortcut(text)).toBeNull();
  });
});

describe("applying a settings file", () => {
  it("updates the settings store once and persists each value", async () => {
    const changes = vi.fn();
    const stop = useSettingsStore.subscribe(changes);
    const read = readSettingsFile(
      fileWith({
        general: { spellcheck: "off", grammar: 0, grammarDialect: "british" },
        appearance: {
          app: { fontSize: 18, zoom: 125, accentColor: "#0B8842" },
          editor: { fontSize: 16, keymap: "vim", lineHeight: "custom", customLineHeight: 1.8 },
          files: { hiddenFiles: [".DS_Store", "*.aux"] },
        },
        experimentation: { latexTools: true },
      }),
      snapshot(),
    );
    if (!read.ok) throw new Error("expected a valid file");
    const proofreading = vi.fn();
    window.addEventListener("oleafly:proofreading-settings-changed", proofreading);
    await applySettingsPlan(read.plan, THEME);
    window.removeEventListener("oleafly:proofreading-settings-changed", proofreading);
    stop();

    expect(changes).toHaveBeenCalledTimes(1);
    expect(proofreading).toHaveBeenCalledTimes(1);
    const state = useSettingsStore.getState();
    expect(state).toMatchObject({
      spellcheck: false,
      harper: false,
      grammarDialect: "british",
      appFontSize: 18,
      appZoom: 125,
      accentColor: "#0b8842",
      editorFontSize: 16,
      editorKeymap: "vim",
      vim: true,
      editorLineHeight: "custom",
      editorCustomLineHeight: 1.8,
      hiddenFilePatterns: [".DS_Store", "*.aux"],
    });
    expect(localStorage.getItem("oleafly.appFontSize")).toBe("18");
    expect(localStorage.getItem("oleafly.fontSize")).toBe("16");
    expect(localStorage.getItem("oleafly.vim")).toBe("1");
    expect(localStorage.getItem("oleafly.spellcheck")).toBe("0");
    expect(localStorage.getItem("oleafly.fileTree.hiddenPatterns")).toBe('[".DS_Store","*.aux"]');
    expect(mocks.setConfig).not.toHaveBeenCalled();
  });

  it("does nothing to a store whose values already match", async () => {
    const changes = vi.fn();
    const stop = useSettingsStore.subscribe(changes);
    const read = readSettingsFile(fileWith({ appearance: { editor: { fontSize: 13 } } }), snapshot());
    if (!read.ok) throw new Error("expected a valid file");
    expect(read.changed).toEqual([]);
    await applySettingsPlan(read.plan, THEME);
    stop();
    expect(changes).not.toHaveBeenCalled();
  });

  it("takes terminal colors from the theme unless the file sets them", async () => {
    const themed = readSettingsFile(fileWith({ appearance: { terminal: { colorTheme: "nord" } } }), snapshot());
    if (!themed.ok) throw new Error("expected a valid file");
    await applySettingsPlan(themed.plan, THEME);
    expect(useSettingsStore.getState().terminalBackground).toBe(TERMINAL_COLOR_THEMES.nord.colors.background);

    const custom = readSettingsFile(
      fileWith({ appearance: { terminal: { colorTheme: "dracula", background: "#101010" } } }),
      snapshot(),
    );
    if (!custom.ok) throw new Error("expected a valid file");
    await applySettingsPlan(custom.plan, THEME);
    expect(useSettingsStore.getState()).toMatchObject({
      terminalColorTheme: "dracula",
      terminalBackground: "#101010",
      terminalForeground: TERMINAL_COLOR_THEMES.dracula.colors.foreground,
    });
  });

  it("keeps custom terminal colors when the file names the color theme already in use", async () => {
    useSettingsStore.getState().setTerminalColorTheme("dracula");
    useSettingsStore.getState().setTerminalBackground("#101010");
    const read = readSettingsFile(
      fileWith({ appearance: { terminal: { colorTheme: "dracula", fontSize: 16 } } }),
      snapshot(),
    );
    if (!read.ok) throw new Error("expected a valid file");
    expect(read.changed).toEqual(["appearance.terminal.fontSize"]);
    await applySettingsPlan(read.plan, THEME);
    expect(useSettingsStore.getState()).toMatchObject({ terminalFontSize: 16, terminalBackground: "#101010" });
  });

  it("announces one proofreading change when grammar rules change with other proofreading settings", async () => {
    const read = readSettingsFile(
      fileWith({ general: { spellcheck: false }, dictionary: { disabledGrammarRules: ["LongSentences"] } }),
      snapshot(),
    );
    if (!read.ok) throw new Error("expected a valid file");
    const proofreading = vi.fn();
    window.addEventListener("oleafly:proofreading-settings-changed", proofreading);
    await applySettingsPlan(read.plan, THEME);
    window.removeEventListener("oleafly:proofreading-settings-changed", proofreading);
    expect(proofreading).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState()).toMatchObject({ spellcheck: false, harperDisabledRules: ["LongSentences"] });
  });

  it("switches the language once", async () => {
    const read = readSettingsFile(fileWith({ general: { language: "fr" } }), snapshot());
    if (!read.ok) throw new Error("expected a valid file");
    await applySettingsPlan(read.plan, THEME);
    expect(mocks.changeLocalePreference).toHaveBeenCalledTimes(1);
    expect(mocks.changeLocalePreference).toHaveBeenCalledWith("fr");
  });

  it("applies shortcuts, editor keys, words, compile options and the theme", async () => {
    useShortcutStore.getState().setBinding("recompile", { key: "r", mod: true });
    const setPreference = vi.fn();
    const read = readSettingsFile(
      fileWith({
        appearance: { app: { theme: "dark", customTheme: { light: { primary: "#112233" }, dark: {}, radius: "4px" } } },
        dictionary: { words: ["Oleafly", "Tectonic"] },
        engine: { compile: { autoCompile: true, mode: "fast" } },
        shortcuts: {
          app: { recompile: "default", commandPalette: "Mod-Shift-p" },
          editor: { uppercase: "", deleteLine: "Mod-Shift-k" },
        },
      }),
      snapshot(),
    );
    if (!read.ok) throw new Error("expected a valid file");
    await applySettingsPlan(read.plan, { preference: "system", setPreference });

    const bindings = useShortcutStore.getState().bindings;
    expect(bindings.recompile).toEqual(defaultShortcutBinding("recompile"));
    expect(bindings.commandPalette).toEqual({ key: "p", mod: true, shift: true });
    expect(useEditorKeymapStore.getState().keys).toMatchObject({ uppercase: "", deleteLine: "Mod-Shift-k" });
    expect(useDictionary.getState().global).toEqual(["Oleafly", "Tectonic"]);
    expect(useCompileStore.getState()).toMatchObject({ autoCompile: true, compileMode: "fast" });
    expect(setPreference).toHaveBeenCalledExactlyOnceWith("dark");
    expect(readThemeCustomization()).toMatchObject({ light: { primary: "#112233" }, radius: "4px" });
  });

  it("merges AI and checkpoint settings into the latest config", async () => {
    mocks.getConfig.mockResolvedValue(baseConfig({ ai_starter_personas_seeded: false }));
    const read = readSettingsFile(
      fileWith({
        data: { checkpoints: { afterCompile: false } },
        ai: {
          customInstructions: "Cite sources.",
          includePdfPreview: "off",
          personas: [{ id: "tutor", name: "Tutor", color: "grape", prompt: "Explain." }],
        },
      }),
      snapshot(),
    );
    if (!read.ok) throw new Error("expected a valid file");
    const aiConfigChanged = vi.fn();
    window.addEventListener("oleafly:ai-config-changed", aiConfigChanged);
    await applySettingsPlan(read.plan, THEME);
    window.removeEventListener("oleafly:ai-config-changed", aiConfigChanged);
    expect(aiConfigChanged).toHaveBeenCalledTimes(1);
    expect((aiConfigChanged.mock.calls[0][0] as CustomEvent<AppConfig>).detail).toMatchObject({
      ai_system_prompt: "Cite sources.",
      ai_personas: [{ id: "tutor" }],
    });
    expect(mocks.setConfig).toHaveBeenCalledTimes(1);
    expect(mocks.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_api_key: "secret-should-never-leave",
        ai_system_prompt: "Cite sources.",
        ai_pdf_capture: false,
        checkpoints_enabled: false,
        ai_personas: [{ id: "tutor", name: "Tutor", color: "grape", prompt: "Explain." }],
        ai_starter_personas_seeded: true,
      }),
    );
    expect(localStorage.getItem("oleafly:ai_pdf_capture")).toBe("0");
  });
});
