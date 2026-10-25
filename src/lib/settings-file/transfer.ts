import { useDictionary } from "@/lib/dictionary";
import { currentTheme, type ThemePreference } from "@/lib/theme";
import {
  applyThemeCustomization,
  readThemeCustomization,
  writeThemeCustomization,
} from "@/lib/theme-customization";
import { getConfig, setConfig, type AppConfig } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useEditorKeymapStore } from "@/store/editor-keymap";
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import {
  applyEditorKeys,
  applyPreferences,
  applyShortcuts,
  preferencesDiffer,
  replaceGlobalWords,
  sameSetting,
  writeStorage,
} from "./apply";
import {
  SETTINGS_FIELDS,
  type CompilePreferences,
  type ConfigPreferences,
  type SettingField,
  type SettingsPlan,
  type SettingsSnapshot,
} from "./schema";
import { isRecord, type SettingIssue } from "./values";

export const SETTINGS_FILE_NAME = "oleafly-settings.json";
const PDF_CAPTURE_KEY = "oleafly:ai_pdf_capture";
const AI_CONFIG_CHANGED_EVENT = "oleafly:ai-config-changed";
const BYTE_ORDER_MARK = 0xfeff;
const COMPILE_KEYS = ["autoCompile", "compileMode", "checkSyntaxBeforeCompile", "stopOnFirstError"] as const;

const configListeners = new Set<() => void>();

export function onConfigPreferencesSaved(listener: () => void): () => void {
  configListeners.add(listener);
  return () => {
    configListeners.delete(listener);
  };
}

export function watchSettingsSources(listener: () => void): () => void {
  const stops = [
    useSettingsStore.subscribe((state, previous) => {
      if (preferencesDiffer(state, previous)) listener();
    }),
    useShortcutStore.subscribe((state, previous) => {
      if (state.bindings !== previous.bindings) listener();
    }),
    useEditorKeymapStore.subscribe((state, previous) => {
      if (state.keys !== previous.keys) listener();
    }),
    useDictionary.subscribe((state, previous) => {
      if (state.global !== previous.global) listener();
    }),
    useCompileStore.subscribe((state, previous) => {
      if (COMPILE_KEYS.some((key) => state[key] !== previous[key])) listener();
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

const FIELD_BY_PATH: ReadonlyMap<string, SettingField> = new Map(
  SETTINGS_FIELDS.map((setting) => [setting.path, setting]),
);
const GROUP_PATHS: ReadonlySet<string> = new Set(
  SETTINGS_FIELDS.flatMap((setting) => {
    const parts = setting.path.split(".");
    return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join("."));
  }),
);

/**
 * Paths 0.4.7 wrote that 0.4.8 dropped. Reading a file skips them silently.
 * `appearance.browser` is listed as a whole because nothing under it is a
 * setting any more, so the reader never walks into it.
 */
export const RETIRED_SETTING_PATHS: ReadonlySet<string> = new Set([
  "experimentation.webBrowser",
  "appearance.browser",
  "appearance.browser.homePage",
  "appearance.browser.searchEngine",
  "shortcuts.app.toggleBrowser",
]);

function pickConfig(config: AppConfig): ConfigPreferences {
  return {
    ai_system_prompt: config.ai_system_prompt ?? "",
    ai_pdf_capture: config.ai_pdf_capture !== false,
    ai_reasoning_summaries: config.ai_reasoning_summaries === true,
    ai_personas: config.ai_personas ?? [],
    checkpoints_enabled: config.checkpoints_enabled !== false,
    checkpoint_notifications: config.checkpoint_notifications !== false,
    research_keep_awake: config.research_keep_awake !== false,
    research_notifications: config.research_notifications !== false,
    research_command_network: config.research_command_network === true,
    research_time_budget_minutes: config.research_time_budget_minutes ?? 120,
  };
}

function compilePreferences(): CompilePreferences {
  const { autoCompile, compileMode, checkSyntaxBeforeCompile, stopOnFirstError } = useCompileStore.getState();
  return { autoCompile, compileMode, checkSyntaxBeforeCompile, stopOnFirstError };
}

export function readConfigPreferences(): Promise<ConfigPreferences | null> {
  return getConfig().then(pickConfig, () => null);
}

export async function captureSettingsSnapshot(theme: ThemePreference): Promise<SettingsSnapshot> {
  return readLocalSnapshot(await readConfigPreferences(), theme);
}

export function readLocalSnapshot(config: ConfigPreferences | null, theme: ThemePreference): SettingsSnapshot {
  return {
    preferences: useSettingsStore.getState(),
    theme,
    customTheme: readThemeCustomization(),
    shortcuts: useShortcutStore.getState().bindings,
    editorKeys: useEditorKeymapStore.getState().keys,
    words: useDictionary.getState().global,
    compile: compilePreferences(),
    config,
  };
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = root;
  for (const part of parts.slice(0, -1)) {
    const child = node[part];
    if (isRecord(child)) {
      node = child;
    } else {
      const created: Record<string, unknown> = {};
      node[part] = created;
      node = created;
    }
  }
  node[parts.at(-1) ?? path] = value;
}

export function buildSettingsDocument(snapshot: SettingsSnapshot): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const setting of SETTINGS_FIELDS) {
    const value = setting.read(snapshot);
    if (value === undefined) continue;
    if (setting.parse(value).ok) setPath(root, setting.path, value);
  }
  return root;
}

function readPath(root: Record<string, unknown>, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split(".")) {
    if (!isRecord(node) || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

export function validSettingsSubset(document: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const setting of SETTINGS_FIELDS) {
    const value = readPath(document, setting.path);
    if (value !== undefined && setting.parse(value).ok) setPath(root, setting.path, value);
  }
  return root;
}

export function serializeSettingsDocument(document: Record<string, unknown>): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export interface SettingsFileProblem {
  path: string;
  issue: SettingIssue;
}

export type SettingsFileRead =
  | { ok: true; plan: SettingsPlan; changed: string[]; ignored: string[] }
  | { ok: false; reason: "notJson" | "notSettings" }
  | { ok: false; reason: "invalid"; problems: SettingsFileProblem[] };

interface Collected {
  setting: SettingField;
  value: unknown;
}

function problemPath(path: string, at: string | undefined): string {
  if (!at) return path;
  return at.startsWith("[") ? `${path}${at}` : `${path}.${at}`;
}

function walk(
  node: Record<string, unknown>,
  prefix: string,
  found: Collected[],
  problems: SettingsFileProblem[],
  ignored: string[],
): void {
  for (const [key, raw] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const setting = FIELD_BY_PATH.get(path);
    if (setting) {
      const parsed = setting.parse(raw);
      if (parsed.ok) found.push({ setting, value: parsed.value });
      else problems.push({ path: problemPath(path, parsed.at), issue: parsed.issue });
    } else if (GROUP_PATHS.has(path)) {
      if (isRecord(raw)) walk(raw, path, found, problems, ignored);
      else problems.push({ path, issue: { kind: "object" } });
    } else if (!RETIRED_SETTING_PATHS.has(path)) {
      ignored.push(path);
    }
  }
}


function emptyPlan(): SettingsPlan {
  return { preferences: {}, shortcuts: {}, editorKeys: {}, compile: {}, config: {} };
}

export function readSettingsFile(text: string, snapshot: SettingsSnapshot): SettingsFileRead {
  let root: unknown;
  try {
    root = JSON.parse(text.codePointAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text);
  } catch {
    return { ok: false, reason: "notJson" };
  }
  if (!isRecord(root) || !Object.keys(root).some((key) => GROUP_PATHS.has(key))) {
    return { ok: false, reason: "notSettings" };
  }
  const found: Collected[] = [];
  const problems: SettingsFileProblem[] = [];
  const ignored: string[] = [];
  walk(root, "", found, problems, ignored);
  if (problems.length > 0) return { ok: false, reason: "invalid", problems };
  const plan = emptyPlan();
  const changed: string[] = [];
  for (const { setting, value } of found) {
    setting.write(value, plan);
    const current = setting.read(snapshot);
    const normalized = current === undefined ? null : setting.parse(current);
    if (!normalized?.ok || !sameSetting(normalized.value, value)) changed.push(setting.path);
  }
  return { ok: true, plan, changed, ignored };
}

function applyCompile(changes: Partial<CompilePreferences>): void {
  const store = useCompileStore.getState();
  if (changes.autoCompile !== undefined && changes.autoCompile !== store.autoCompile) {
    store.setAutoCompile(changes.autoCompile);
  }
  if (changes.compileMode !== undefined && changes.compileMode !== store.compileMode) {
    store.setCompileMode(changes.compileMode);
  }
  if (
    changes.checkSyntaxBeforeCompile !== undefined &&
    changes.checkSyntaxBeforeCompile !== store.checkSyntaxBeforeCompile
  ) {
    store.setCheckSyntaxBeforeCompile(changes.checkSyntaxBeforeCompile);
  }
  if (changes.stopOnFirstError !== undefined && changes.stopOnFirstError !== store.stopOnFirstError) {
    store.setStopOnFirstError(changes.stopOnFirstError);
  }
}

async function applyConfig(changes: Partial<ConfigPreferences>): Promise<void> {
  const keys = Object.keys(changes) as (keyof ConfigPreferences)[];
  if (keys.length === 0) return;
  const current = await getConfig();
  const next: AppConfig = { ...current };
  let changed = false;
  for (const key of keys) {
    if (sameSetting(current[key], changes[key])) continue;
    Object.assign(next, { [key]: changes[key] });
    changed = true;
  }
  if (changes.ai_personas && !current.ai_starter_personas_seeded) {
    next.ai_starter_personas_seeded = true;
    changed = true;
  }
  if (changes.ai_pdf_capture !== undefined) writeStorage(PDF_CAPTURE_KEY, changes.ai_pdf_capture ? "1" : "0");
  if (!changed) return;
  await setConfig(next);
  window.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED_EVENT, { detail: next }));
  for (const listener of configListeners) listener();
}

export interface ThemeControl {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export async function applySettingsPlan(plan: SettingsPlan, theme: ThemeControl): Promise<void> {
  applyPreferences(plan.preferences);
  if (plan.customTheme && !sameSetting(plan.customTheme, readThemeCustomization())) {
    applyThemeCustomization(currentTheme(), writeThemeCustomization(plan.customTheme));
  }
  if (plan.theme && plan.theme !== theme.preference) theme.setPreference(plan.theme);
  applyShortcuts(plan.shortcuts);
  applyEditorKeys(plan.editorKeys);
  if (plan.words) replaceGlobalWords(plan.words);
  applyCompile(plan.compile);
  await applyConfig(plan.config);
}
