import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { getQueriesForElement, queries, screen } from "@testing-library/dom";
import { resetSidebarViewState } from "./src/store/sidebar-view-state";
import { provideTestCatalogs } from "@oleafly/i18n-contract/testing";
import diagram from "./src/i18n/locales/en/diagram.json" with { type: "json" };
import editor from "./src/i18n/locales/en/editor.json" with { type: "json" };
import preflight from "./src/i18n/locales/en/preflight.json" with { type: "json" };
import preview from "./src/i18n/locales/en/preview.json" with { type: "json" };
import templates from "./src/i18n/locales/en/templates.json" with { type: "json" };

const { wysiwyg, ...editorPackage } = editor.package;
provideTestCatalogs({
  diagram: diagram.package,
  editor: editorPackage,
  preflight,
  preview: preview.package,
  templates: templates.package,
  wysiwyg,
});

vi.mock("@lobehub/icons", () => {
  const stub = () => {
    const Icon = () => null;
    Icon.Color = () => null;
    Icon.Avatar = () => null;
    Icon.Text = () => null;
    Icon.Combine = () => null;
    return Icon;
  };
  return {
    OpenAI: stub(),
    Anthropic: stub(),
    Gemini: stub(),
    Groq: stub(),
    OpenRouter: stub(),
    DeepSeek: stub(),
    Mistral: stub(),
    Grok: stub(),
    Ollama: stub(),
    Perplexity: stub(),
    ZAI: stub(),
    MCP: stub(),
    Browserless: stub(),
  };
});

// Testing Library and React DOM check for a DOM once, when they load. A test
// file in the node environment that sets up its own JSDOM (installUiDom, or a
// JSDOM in beforeAll) does so after this file runs, so:
// - `screen` would stay bound to no document (jest-dom above loads it). Its
//   queries look up the current document.body on each call instead.
// - React DOM loaded without a DOM reads text fields from key events, and
//   fireEvent.change alone never reaches onChange. So Testing Library, which
//   loads React DOM, is loaded here only when a DOM already exists (the jsdom
//   environment). Otherwise the test file loads it once its JSDOM exists.
const currentBodyScreen = screen as unknown as Record<string, unknown>;
for (const name of Object.keys(queries)) {
  currentBodyScreen[name] = (...args: unknown[]) =>
    (getQueriesForElement(document.body) as unknown as Record<string, (...rest: unknown[]) => unknown>)[name](...args);
}
let testingLibrary = typeof document === "undefined" ? undefined : await import("@testing-library/react");

afterEach(async () => {
  if (!testingLibrary && typeof document !== "undefined") testingLibrary = await import("@testing-library/react");
  testingLibrary?.cleanup();
  resetSidebarViewState();
});

if (typeof localStorage === "undefined") {
  const lsValues = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => lsValues.get(key) ?? null,
    setItem: (key: string, value: string) => lsValues.set(key, value),
    removeItem: (key: string) => lsValues.delete(key),
    clear: () => lsValues.clear(),
    key: (index: number) => Array.from(lsValues.keys())[index] ?? null,
    get length() {
      return lsValues.size;
    },
  } as Storage);
}

if (typeof ResizeObserver === "undefined") {
  function noop() {}
  function resizeObserverStub() {
    return { observe: noop, unobserve: noop, disconnect: noop };
  }
  (globalThis as Record<string, unknown>).ResizeObserver = resizeObserverStub;
}

const { i18n, initializeI18n } = await import("./src/i18n");
if (!i18n.isInitialized) {
  await initializeI18n({
    preference: "en",
    systemLocale: async () => "en",
    missingKeyMode: "throw",
  });
}
