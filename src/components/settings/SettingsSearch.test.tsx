// @vitest-environment jsdom

import { Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { lazy } from "@/lib/preloadable";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { buildSettingsIndex, type CatalogPath, type SettingsSearchSection } from "./settings-search";
import { openSettingsTabFor, revealSettingsRow, useSettingsSearch } from "./SettingsSearch";

const BUNDLES: Record<string, unknown> = { core: enCore, notes: enNotes, settings: enSettings, shell: enShell };

function lookup(path: CatalogPath): unknown {
  const [namespace, ...keys] = path;
  let node: unknown = BUNDLES[namespace];
  for (const key of keys) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

const SECTION_TABS: readonly (readonly [SettingsSearchSection, readonly string[]])[] = [
  ["appearance", ["app", "editor", "terminal", "pdf", "files"]],
  ["data", ["local", "cloud"]],
  ["ai", ["providers", "agents", "instructions", "personas", "skills", "mcp", "tools"]],
  ["engine", ["latex", "typst", "markdown", "quarto", "calepin"]],
  ["downloads", ["fonts", "templates", "dictionaries", "sources"]],
  ["integrations", ["git-hosting", "overleaf", "alphaxiv", "zotero", "citation-search", "desktop-apps", "oleafly-mcp"]],
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
      ["appearance-tab-app", "appearance-tab-editor", "appearance-tab-pdf", "appearance-tab-files"],
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

  it("opens the Notes tab for every Notes appearance row", () => {
    const values = ["app", "editor", "terminal", "pdf", "files", "notes"];
    const index = buildSettingsIndex(lookup, "en", "macos", new Set(["notes"]));
    const rows = (index.get("appearance")?.rows ?? []).filter((row) => row.path[1] === "notes");
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const strip = radixStrip(values, "app");
      expect(pressed(strip, row.path), row.path.join(".")).toBe("notes");
      strip.remove();
    }
  });

  it("never presses a tab that was open while the row was looked for", () => {
    const appearance = tabStrip(
      ["appearance-tab-app", "appearance-tab-editor", "appearance-tab-pdf"],
      "appearance-tab-app",
    );
    const visited = new Set<HTMLElement>();
    expect(pressed(appearance, ["appearance", "customTheme", "radius"], visited)).toBeNull();
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
      ["integrations-tab-git-hosting", "integrations-tab-oleafly-mcp"],
      "integrations-tab-git-hosting",
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

type HarnessSection = "appearance" | "general";

const HARNESS_SECTIONS: readonly { id: HarnessSection; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "general", label: "General" },
];
const CALLOUTS = { label: "Callout style", path: ["appearance", "notes", "callouts"] };
const TEXT = {
  pick: "Pick",
  reveal: "Reveal",
  general: "General",
  app: "App",
  notes: "Notes",
  accent: "Accent color",
  loading: "Loading",
};
const REVEAL_WINDOW_MS = 2_000;
const REVEAL_LIMIT_MS = 15_000;

function CalloutsRow({ testId }: Readonly<{ testId: string }>) {
  return (
    <div className="rounded-lg border" data-testid={testId}>
      <p>{CALLOUTS.label}</p>
      <button type="button">{TEXT.pick}</button>
    </div>
  );
}

function notesTabLoadingFor(ms: number) {
  return lazy(
    () =>
      new Promise<{ default: ComponentType }>((resolve) => {
        setTimeout(() => resolve({ default: () => <CalloutsRow testId="notes-callouts" /> }), ms);
      }),
  );
}

function Ticker() {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTicks((count) => count + 1), 500);
    return () => clearInterval(timer);
  }, []);
  return <p>{`Checked ${ticks} times`}</p>;
}

function RevealHarness({ NotesTab, ticking = false }: Readonly<{ NotesTab: ComponentType; ticking?: boolean }>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<HarnessSection>("appearance");
  const search = useSettingsSearch({
    open: true,
    resetKey: null,
    sections: HARNESS_SECTIONS,
    currentSection: section,
    onSelectSection: setSection,
    suspended: false,
    containerRef,
  });
  return (
    <>
      <button type="button" onClick={() => search.revealRow("appearance", CALLOUTS)}>
        {TEXT.reveal}
      </button>
      <button type="button" onClick={() => setSection("general")}>
        {TEXT.general}
      </button>
      <div ref={containerRef}>
        {ticking ? <Ticker /> : null}
        {section === "appearance" ? (
          <Tabs defaultValue="app">
            <TabsList>
              <TabsTrigger value="app">{TEXT.app}</TabsTrigger>
              <TabsTrigger value="notes">{TEXT.notes}</TabsTrigger>
            </TabsList>
            <TabsContent value="app">
              <p>{TEXT.accent}</p>
            </TabsContent>
            <TabsContent value="notes">
              <Suspense fallback={<p>{TEXT.loading}</p>}>
                <NotesTab />
              </Suspense>
            </TabsContent>
          </Tabs>
        ) : (
          <CalloutsRow testId="general-callouts" />
        )}
      </div>
    </>
  );
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useSettingsSearch reveal", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("tints a row on a lazy tab that loads after the reveal window has passed", async () => {
    render(<RevealHarness NotesTab={notesTabLoadingFor(3 * REVEAL_WINDOW_MS)} />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.reveal }));
    expect(screen.getByRole("tab", { name: TEXT.notes })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(TEXT.loading)).toBeInTheDocument();

    await wait(3 * REVEAL_WINDOW_MS);
    await wait(100);
    const row = screen.getByTestId("notes-callouts");
    expect(row).toHaveAttribute("data-settings-search-hit");
    expect(document.activeElement).toBe(within(row).getByRole("button", { name: TEXT.pick }));
  });

  it("stops looking at the limit even while the page keeps changing", async () => {
    render(<RevealHarness NotesTab={notesTabLoadingFor(REVEAL_LIMIT_MS + 1_000)} ticking />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.reveal }));

    await wait(REVEAL_LIMIT_MS + 1_000);
    await wait(100);
    expect(screen.getByTestId("notes-callouts")).not.toHaveAttribute("data-settings-search-hit");
    expect(document.querySelector("[data-settings-search-hit]")).toBeNull();
  });

  it("gives up when the user moves to another section before the row loads", async () => {
    render(<RevealHarness NotesTab={notesTabLoadingFor(3 * REVEAL_WINDOW_MS)} />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.reveal }));
    fireEvent.click(screen.getByRole("button", { name: TEXT.general }));

    await wait(3 * REVEAL_WINDOW_MS);
    await wait(100);
    expect(screen.getByTestId("general-callouts")).not.toHaveAttribute("data-settings-search-hit");
  });
});
