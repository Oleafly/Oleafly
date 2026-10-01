// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { buildSettingsIndex, type CatalogPath, type SettingsSearchSection } from "./settings-search";
import { openSettingsTabFor, revealSettingsRow } from "./SettingsSearch";

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

/** The top-level tab strip of each section whose rows all sit inside it, as Radix tab values. */
const SECTION_TABS: readonly (readonly [SettingsSearchSection, readonly string[]])[] = [
  ["appearance", ["app", "editor", "terminal", "pdf", "browser", "files"]],
  ["data", ["local", "cloud"]],
  ["ai", ["providers", "agents", "instructions", "personas", "skills", "mcp"]],
  ["engine", ["latex", "typst", "markdown"]],
  ["downloads", ["fonts", "templates", "dictionaries"]],
  ["integrations", ["github", "alphaxiv", "zotero", "citation-search", "oleafly-mcp"]],
  ["shortcuts", ["application", "editor", "codeIntelligence", "pdf"]],
];

function tabStrip(testIds: readonly string[], selected: string): HTMLElement {
  const container = document.createElement("div");
  for (const testId of testIds) {
    const tab = document.createElement("button");
    tab.setAttribute("role", "tab");
    tab.dataset.testid = testId;
    tab.setAttribute("aria-selected", String(testId === selected));
    container.append(tab);
  }
  document.body.append(container);
  return container;
}

function pressed(
  container: HTMLElement,
  path: readonly string[],
  visited: Set<HTMLElement> = new Set(),
): string | null {
  let clicked: string | null = null;
  const onClick = (event: Event) => {
    clicked = (event.target as HTMLElement).dataset.testid ?? null;
  };
  container.addEventListener("click", onClick);
  openSettingsTabFor(container, path, visited);
  container.removeEventListener("click", onClick);
  return clicked;
}

/** Selects a tab the way a user would, without the reveal knowing. */
function select(container: HTMLElement, testId: string) {
  for (const tab of container.querySelectorAll<HTMLElement>('[role="tab"]')) {
    tab.setAttribute("aria-selected", String(tab.dataset.testid === testId));
  }
}

function radixStrip(values: readonly string[], selected: string): HTMLElement {
  const container = document.createElement("div");
  for (const value of values) {
    const tab = document.createElement("button");
    tab.setAttribute("role", "tab");
    tab.id = `radix-r1-trigger-${value}`;
    tab.dataset.testid = value;
    tab.setAttribute("aria-selected", String(value === selected));
    container.append(tab);
  }
  document.body.append(container);
  return container;
}

describe("openSettingsTabFor", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("opens the AI MCP tab for the assistant's MCP servers", () => {
    const ai = tabStrip(
      ["ai-settings-tab-providers", "ai-settings-tab-agents", "ai-settings-tab-mcp"],
      "ai-settings-tab-providers",
    );
    expect(pressed(ai, ["mcp", "servers"])).toBe("ai-settings-tab-mcp");
  });

  it("opens the PDF tab for PDF preview rows, whose keys say preview", () => {
    const appearance = tabStrip(
      ["appearance-tab-app", "appearance-tab-editor", "appearance-tab-pdf", "appearance-tab-browser"],
      "appearance-tab-app",
    );
    expect(pressed(appearance, ["appearance", "preview", "darkMode"])).toBe("appearance-tab-pdf");
  });

  it("opens the Editor tab of Keyboard Shortcuts for the editor keys", () => {
    const shortcuts = tabStrip(
      ["shortcuts-tab-application", "shortcuts-tab-editor", "shortcuts-tab-pdf"],
      "shortcuts-tab-application",
    );
    expect(pressed(shortcuts, ["shortcuts", "editorKeys"])).toBe("shortcuts-tab-editor");
  });

  it("falls back to a tab named by the row's keys", () => {
    const appearance = tabStrip(
      ["appearance-tab-app", "appearance-tab-editor", "appearance-tab-pdf"],
      "appearance-tab-pdf",
    );
    expect(pressed(appearance, ["appearance", "editor", "fontSize"])).toBe("appearance-tab-editor");
  });

  it("opens a section's default tab for a row on it when another tab is open", () => {
    const engine = tabStrip(
      ["engines-tab-latex", "engines-tab-typst", "engines-tab-markdown"],
      "engines-tab-typst",
    );
    expect(pressed(engine, ["engine", "defaultEngine"])).toBe("engines-tab-latex");
    const data = tabStrip(["data-tab-local", "data-tab-cloud"], "data-tab-cloud");
    expect(pressed(data, ["settings", "data", "storage"])).toBe("data-tab-local");
    const ai = tabStrip(
      ["ai-settings-tab-providers", "ai-settings-tab-skills"],
      "ai-settings-tab-skills",
    );
    expect(pressed(ai, ["ai", "approvals", "file"])).toBe("ai-settings-tab-providers");
  });

  it("opens one tab for every row of a tabbed section, whichever tab is open", () => {
    const index = buildSettingsIndex(lookup, "en", "macos");
    for (const [section, values] of SECTION_TABS) {
      for (const row of index.get(section)?.rows ?? []) {
        const outcomes = values.map((selected) => {
          const strip = radixStrip(values, selected);
          const outcome = pressed(strip, row.path);
          strip.remove();
          return outcome;
        });
        const targets = new Set(outcomes.filter((outcome) => outcome !== null));
        const where = `${section} ${row.path.join(".")}`;
        expect([...targets], where).toHaveLength(1);
        const [target] = targets;
        expect(outcomes[values.indexOf(target as string)], where).toBeNull();
      }
    }
  });

  it("never presses a tab that was open while the row was looked for", () => {
    const appearance = tabStrip(
      ["appearance-tab-app", "appearance-tab-editor", "appearance-tab-pdf"],
      "appearance-tab-app",
    );
    const visited = new Set<HTMLElement>();
    // The row's tab is already open, but the row is not on it (a collapsed panel).
    expect(pressed(appearance, ["appearance", "customTheme", "radius"], visited)).toBeNull();
    // The user moves on to another tab while the reveal is still looking.
    select(appearance, "appearance-tab-editor");
    expect(pressed(appearance, ["appearance", "customTheme", "radius"], visited)).toBeNull();
  });

  it("presses a closed tab once, even if the user leaves it before the row shows up", () => {
    const appearance = tabStrip(
      ["appearance-tab-app", "appearance-tab-editor", "appearance-tab-pdf"],
      "appearance-tab-editor",
    );
    const visited = new Set<HTMLElement>();
    expect(pressed(appearance, ["appearance", "preview", "darkMode"], visited)).toBe("appearance-tab-pdf");
    select(appearance, "appearance-tab-editor");
    expect(pressed(appearance, ["appearance", "preview", "darkMode"], visited)).toBeNull();
  });

  it("does not guess from the keys when the row's tab is known but not on the page", () => {
    const integrations = tabStrip(
      ["integrations-tab-github", "integrations-tab-oleafly-mcp"],
      "integrations-tab-github",
    );
    expect(pressed(integrations, ["mcp", "servers"])).toBeNull();
  });
});

describe("revealSettingsRow", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function page(html: string): HTMLElement {
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    return container;
  }

  it("tints the region an invisible heading names, not the heading", () => {
    const container = page(`
      <section aria-labelledby="application-shortcuts">
        <h3 id="application-shortcuts" class="sr-only">Application shortcuts</h3>
        <div class="rounded-lg border"><p>Command palette</p><button type="button">Edit</button></div>
      </section>`);
    const target = revealSettingsRow(container, "Application shortcuts");
    expect(target?.tagName).toBe("SECTION");
    expect(target).toHaveAttribute("data-settings-search-hit");
    expect(target?.closest(".sr-only")).toBeNull();
    expect(container.querySelector(".sr-only")).not.toHaveAttribute("data-settings-search-hit");
    expect(document.activeElement).toBe(container.querySelector("button"));
  });

  it("tints the first row after an invisible heading that names no region", () => {
    const container = page(`
      <div class="rounded-lg border"><p>Before</p></div>
      <h3 class="sr-only">Editor keys</h3>
      <div class="rounded-lg border" data-testid="first"><p>Indent</p></div>`);
    const target = revealSettingsRow(container, "Editor keys");
    expect(target).toBe(container.querySelector('[data-testid="first"]'));
    expect(target).toHaveAttribute("data-settings-search-hit");
  });

  it("still tints a visible heading itself", () => {
    const container = page(`<h3 class="text-xs">Default compile engine</h3>`);
    const target = revealSettingsRow(container, "Default compile engine");
    expect(target?.tagName).toBe("H3");
    expect(target).toHaveAttribute("data-settings-search-hit");
  });
});
