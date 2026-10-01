import { describe, expect, it } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import {
  bestSettingsHit,
  buildSettingsIndex,
  cleanCatalogText,
  matchSettingsSections,
  normalizeSearchText,
  searchSettings,
  SETTINGS_SEARCH_EXCLUDED,
  SETTINGS_SEARCH_SECTIONS,
  SETTINGS_SEARCH_SOURCES,
  SETTINGS_SEARCH_TABS,
  settingsTabFor,
  type CatalogPath,
  type SettingsSearchHit,
  type SettingsSearchIndex,
} from "./settings-search";

const BUNDLES: Record<string, unknown> = { core: enCore, settings: enSettings, shell: enShell };

function lookup(path: CatalogPath): unknown {
  const [namespace, ...keys] = path;
  let node: unknown = BUNDLES[namespace];
  for (const key of keys) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

const nav = enShell.settings.nav as Record<string, string>;
const SECTIONS = SETTINGS_SEARCH_SECTIONS.filter((id) => id !== "developer").map((id) => ({
  id,
  label: nav[id] ?? id,
}));
const index = buildSettingsIndex(lookup, "en", "linux");

function rowLabels(entries: SettingsSearchIndex, section?: string): string[] {
  return [...entries]
    .filter(([id]) => section === undefined || id === section)
    .flatMap(([, entry]) => entry.rows.map((row) => row.label));
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, position) => key === b[position]);
}

describe("settings search index", () => {
  it("finds a setting by its row label", () => {
    expect(matchSettingsSections(index, SECTIONS, "font size")).toEqual(["appearance"]);
    expect(matchSettingsSections(index, SECTIONS, "zotero")).toEqual(["integrations"]);
  });

  it("matches the section title and every word of the query", () => {
    expect(matchSettingsSections(index, SECTIONS, "keyboard shortcuts")).toEqual(["shortcuts"]);
    expect(matchSettingsSections(index, SECTIONS, "zotero qqqzzz")).toEqual([]);
  });

  it("returns every section with no rows when the query is blank", () => {
    expect(searchSettings(index, SECTIONS, "   ")).toEqual(SECTIONS.map(({ id }) => ({ id, rows: [] })));
  });

  it("gives each matching row the catalog path it came from", () => {
    const [appearance] = searchSettings(index, SECTIONS, "editor font size");
    expect(appearance.id).toBe("appearance");
    expect(appearance.rows[0]).toEqual({
      label: enSettings.appearance.editor.fontSize.label,
      path: ["appearance", "editor", "fontSize"],
    });
  });

  it("ignores case, accents and markup", () => {
    expect(normalizeSearchText("  Thème   SOMBRE ")).toBe("theme sombre");
    expect(cleanCatalogText("Open <strong>{{name}}</strong> now")).toBe("Open now");
    expect(cleanCatalogText("Settings > <scr<b>ipt>Shortcuts")).toBe("Settings > Shortcuts");
  });

  it("matches words from their start, so a short query does not match every section", () => {
    const hits = searchSettings(index, SECTIONS, "ai");
    expect(bestSettingsHit(hits)).toBe("ai");
    expect(hits.length).toBeLessThan(SECTIONS.length);
    const rows = hits.flatMap((hit) => hit.rows.map((row) => row.label));
    expect(rows).not.toContain("Theme customization");
    expect(rows).not.toContain("Auto-close math");
  });

  it("opens the section whose title matches, then a row label, then other text", () => {
    expect(bestSettingsHit(searchSettings(index, SECTIONS, "citation"))).toBe("integrations");
    expect(bestSettingsHit(searchSettings(index, SECTIONS, "keyboard"))).toBe("shortcuts");
    expect(bestSettingsHit([])).toBeNull();
  });

  it("stays on the open section when it matches as well as the best one", () => {
    const tied: SettingsSearchHit[] = [
      { id: "general", rows: [], match: "keyword" },
      { id: "dictionary", rows: [], match: "keyword" },
      { id: "downloads", rows: [], match: "text" },
    ];
    expect(bestSettingsHit(tied)).toBe("general");
    expect(bestSettingsHit(tied, "dictionary")).toBe("dictionary");
    expect(bestSettingsHit(tied, "downloads")).toBe("general");
  });

  it("still finds text inside words for scripts written without spaces", () => {
    const cjk: SettingsSearchIndex = new Map([
      ["appearance", { text: normalizeSearchText("编辑器字体大小"), keywords: "", rows: [] }],
    ]);
    const sections = [{ id: "appearance" as const, label: "外观" }];
    expect(matchSettingsSections(cjk, sections, "字体")).toEqual(["appearance"]);
    const latin: SettingsSearchIndex = new Map([
      ["appearance", { text: normalizeSearchText("Install and repair"), keywords: "", rows: [] }],
    ]);
    expect(matchSettingsSections(latin, [{ id: "appearance" as const, label: "Look" }], "ai")).toEqual([]);
  });

  it("reads a character outside the Basic Multilingual Plane before a term as one character", () => {
    const sections = [{ id: "appearance" as const, label: "Look" }];
    const entry = (text: string): SettingsSearchIndex =>
      new Map([["appearance", { text: normalizeSearchText(text), keywords: "", rows: [] }]]);
    // A letter (U+1D400) keeps the term inside a word; an emoji or a lone
    // surrogate does not, and a Han character is in a script without spaces.
    expect(matchSettingsSections(entry("\u{1D400}ai budget"), sections, "ai")).toEqual([]);
    expect(matchSettingsSections(entry("\u{1F600}ai budget"), sections, "ai")).toEqual(["appearance"]);
    expect(matchSettingsSections(entry("\uDC00ai budget"), sections, "ai")).toEqual(["appearance"]);
    expect(matchSettingsSections(entry("\u{20000}ai budget"), sections, "ai")).toEqual(["appearance"]);
  });

  it("keeps dialog and sign-in titles out of the matching rows", () => {
    const labels = [...index.values()].flatMap((entry) => entry.rows.map((row) => row.label));
    for (const transient of [
      enSettings.proofreading.clear.title,
      enSettings.ai.providers.removeDialog.title,
      enSettings.ai.models.deleteDialog.title,
      enSettings.github.device.title,
      enSettings.mcp.servers.remove.title,
      enSettings.mcp.servers.empty.title,
      enSettings.mcp.import.title,
      enSettings.mcp.import.duplicates.overwrite.label,
      enSettings.mcp.registry.title,
    ]) {
      expect(labels, transient).not.toContain(transient);
    }
    expect(labels).toContain(enSettings.appearance.editor.fontSize.label);
    expect(labels).toContain(enSettings.ai.agents.custom.label);
  });

  it("still finds the section from the words of a flow that is not a row", () => {
    expect(bestSettingsHit(searchSettings(index, SECTIONS, "official mcp registry"))).toBe("ai");
  });

  it("files the assistant's MCP servers under AI and the Oleafly MCP server under Integrations", () => {
    expect(bestSettingsHit(searchSettings(index, SECTIONS, "assistant mcp servers"))).toBe("ai");
    expect(bestSettingsHit(searchSettings(index, SECTIONS, "mcp servers"))).toBe("ai");
    expect(bestSettingsHit(searchSettings(index, SECTIONS, "oleafly mcp server"))).toBe("integrations");
    expect(rowLabels(index, "ai")).toContain(enSettings.mcp.servers.title);
    expect(rowLabels(index, "integrations")).not.toContain(enSettings.mcp.servers.title);
    expect(rowLabels(index, "integrations")).toContain(enSettings.mcp.section.title);
  });

  it("files cookie import under Appearance, where the in-app browser settings are", () => {
    expect(rowLabels(index, "appearance")).toContain(enSettings.integrations.cookies.title);
    expect(rowLabels(index, "integrations")).not.toContain(enSettings.integrations.cookies.title);
  });

  it("indexes only the file manager rows this platform shows", () => {
    const labels = enSettings.systemIntegration;
    const mac = rowLabels(buildSettingsIndex(lookup, "en", "macos"), "general");
    const windows = rowLabels(buildSettingsIndex(lookup, "en", "windows"), "general");
    const linux = rowLabels(index, "general");
    expect(mac).toContain(labels.quickAction.label);
    expect(mac).not.toContain(labels.explorerMenu.label);
    expect(mac).not.toContain(labels.dolphin.label);
    expect(windows).toContain(labels.explorerMenu.label);
    expect(windows).not.toContain(labels.quickAction.label);
    expect(windows).not.toContain(labels.nemo.label);
    expect(linux).toEqual(expect.arrayContaining([labels.dolphin.label, labels.folderOpenWith.label]));
    expect(linux).not.toContain(labels.quickAction.label);
    const macIndex = buildSettingsIndex(lookup, "en", "macos");
    expect(matchSettingsSections(macIndex, SECTIONS, "dolphin")).toEqual([]);
    expect(matchSettingsSections(index, SECTIONS, "dolphin")).toEqual(["general"]);
  });

  it("leaves error and toast text out of the index", () => {
    const failed = enShell.settings.data.storage.error;
    expect(failed).toBeTruthy();
    expect(index.get("data")?.text).not.toContain(normalizeSearchText(failed));
  });
});

describe("settings search sources", () => {
  it("points every source at a catalog subtree that exists", () => {
    for (const section of SETTINGS_SEARCH_SECTIONS) {
      for (const path of SETTINGS_SEARCH_SOURCES[section]) {
        expect(lookup(path), path.join(".")).toBeDefined();
      }
    }
  });

  it("maps or excludes every settings subtree, so moved strings are not lost", () => {
    const listed = [...Object.values(SETTINGS_SEARCH_SOURCES).flat(), ...SETTINGS_SEARCH_EXCLUDED];
    const subtrees: CatalogPath[] = [
      ...Object.keys(enSettings).map((key): CatalogPath => ["settings", key]),
      ...Object.keys(enShell.settings).map((key): CatalogPath => ["shell", "settings", key]),
    ];
    const missing = subtrees.filter((path) => !listed.some((entry) => samePrefix(entry, path)));
    expect(missing.map((path) => path.join("."))).toEqual([]);
  });

  it("maps or excludes every sibling of a subtree it splits", () => {
    const listed = [...Object.values(SETTINGS_SEARCH_SOURCES).flat(), ...SETTINGS_SEARCH_EXCLUDED];
    const covered = (path: CatalogPath) =>
      listed.some((entry) => samePrefix(entry, path) || samePrefix(path, entry));
    const missing = new Set<string>();
    for (const entry of listed) {
      for (let length = entry[0] === "shell" ? 3 : 2; length < entry.length; length += 1) {
        const parent = entry.slice(0, length) as unknown as CatalogPath;
        const node = lookup(parent);
        if (typeof node !== "object" || node === null) continue;
        for (const key of Object.keys(node)) {
          const child: CatalogPath = [...parent, key];
          if (!covered(child)) missing.add(child.join("."));
        }
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("has search keywords for every section a user can pick", () => {
    const keywords = enShell.settings.search.keywords as Record<string, string>;
    for (const { id } of SECTIONS) expect(keywords[id], id).toBeTruthy();
  });
});

describe("settings search tabs", () => {
  it("names the sub-tab of rows whose keys do not name it", () => {
    expect(settingsTabFor(["appearance", "preview", "darkMode"])).toBe("pdf");
    expect(settingsTabFor(["integrations", "cookies"])).toBe("browser");
    expect(settingsTabFor(["shortcuts", "editorKeys"])).toBe("editor");
    expect(settingsTabFor(["downloads", "fontPacks", "lato"])).toBe("fonts");
    expect(settingsTabFor(["mcp", "servers"])).toBe("mcp");
    expect(settingsTabFor(["mcp", "section", "port"])).toBe("oleafly-mcp");
    expect(settingsTabFor(["appearance", "editor", "fontSize"])).toBeNull();
  });

  it("names the default tab for rows on it, so they open from another tab", () => {
    expect(settingsTabFor(["engine", "defaultEngine"])).toBe("latex");
    expect(settingsTabFor(["engine", "choices", "latexmk"])).toBe("latex");
    expect(settingsTabFor(["engine", "distributions"])).toBe("latex");
    expect(settingsTabFor(["engine", "packages"])).toBe("latex");
    expect(settingsTabFor(["engine", "tagging"])).toBe("latex");
    expect(settingsTabFor(["ai", "approvals", "file"])).toBe("providers");
    expect(settingsTabFor(["ai", "budget"])).toBe("providers");
    expect(settingsTabFor(["ai", "models"])).toBe("providers");
    expect(settingsTabFor(["settings", "data", "storage"])).toBe("local");
    expect(settingsTabFor(["settings", "data", "recycleBin"])).toBe("local");
    expect(settingsTabFor(["settings", "data", "danger"])).toBe("local");
    expect(settingsTabFor(["checkpoints", "afterCompile"])).toBe("local");
  });

  it("points every tab entry at rows the index has", () => {
    const paths = [...buildSettingsIndex(lookup, "en", "linux").values()].flatMap((entry) =>
      entry.rows.map((row) => row.path.join(".")),
    );
    for (const prefix of Object.keys(SETTINGS_SEARCH_TABS)) {
      expect(
        paths.some((path) => path === prefix || path.startsWith(`${prefix}.`)),
        prefix,
      ).toBe(true);
    }
  });
});

function samePrefix(entry: CatalogPath, path: CatalogPath): boolean {
  return samePath(entry.slice(0, path.length), path);
}
