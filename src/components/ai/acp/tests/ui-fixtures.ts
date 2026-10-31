import { JSDOM } from "jsdom";
import type { AcpAgentStatus, AcpConfigOption, AcpEvent, AcpModeOption, AcpSelectChoice, AcpSession } from "@/lib/acp";

// Testing Library loads React DOM, which looks for a DOM once, when it loads.
// Test files import this module before installUiDom() runs, so the helpers
// load Testing Library when they first need it, after the DOM exists.
const testingLibrary = () => import("@testing-library/react");

export async function initTestI18n(): Promise<void> {
  const { i18n, initializeI18n } = await import("@/i18n");
  if (i18n.isInitialized) return;
  await initializeI18n({
    preference: "en",
    systemLocale: async () => "en",
    missingKeyMode: "throw",
  });
}

export function installUiDom() {
  const options = { url: "https://oleafly.test", pretendToBeVisual: true };
  const dom = new JSDOM("<!doctype html><html><body></body></html>", options);
  const previous = new Map<string, PropertyDescriptor | undefined>();
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLFormElement: dom.window.HTMLFormElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver,
    FileReader: dom.window.FileReader, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: ObserverStub, IntersectionObserver: ObserverStub, DOMRect: dom.window.DOMRect,
  };
  const inherited: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (!/^[A-Z]/.test(key) || key in globalThis) continue;
    const value = (dom.window as unknown as Record<string, unknown>)[key];
    if (typeof value === "function") inherited[key] = value;
  }
  for (const [key, value] of Object.entries({ ...inherited, ...globals })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} }, detachEvent: { configurable: true, value: () => {} },
  });
  Object.defineProperties(dom.window.Element.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => {} },
    releasePointerCapture: { configurable: true, value: () => {} },
    scrollIntoView: { configurable: true, value: () => {} },
  });
  Object.defineProperty(dom.window, "ResizeObserver", { configurable: true, writable: true, value: ObserverStub });
  return { dom, restore: async () => {
    // React renders on setImmediate in Node. Work the last test queued, such
    // as a promise that settled as it ended, must run while the DOM globals
    // still exist, or it throws "window is not defined" after the file ends.
    for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setImmediate(resolve));
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}

export function agent(id = "fixture", overrides: Partial<AcpAgentStatus> = {}): AcpAgentStatus {
  return {
    definition: { id, name: "Research CLI", version: "1.2.3", description: "Research helper", builtin: false, distribution: { npx: { package: "research-fixture@1.2.3", cmd: "research-fixture" } } },
    platform: "test-platform", installed: true, executable: "/tools/research-fixture", installedVersion: null,
    managed: false, canInstall: true, reason: null, signInHint: "Run research-fixture login", taskUnavailableReason: null,
    cli: null, bridgeSharedWithCli: false,
    ...overrides,
  };
}

export function session(id = "saved", overrides: Partial<AcpSession> = {}): AcpSession {
  return {
    id, projectId: "paper", projectPath: "/paper", agentId: "fixture", agentVersion: "1.2.3",
    nativeSessionId: `native-${id}`, parentSessionId: null, taskId: null, title: `Conversation ${id}`,
    status: "ready", createdAt: 1, updatedAt: 1, turnId: null, lastSequence: 0, error: null, authMethods: [],
    capabilities: { loadSession: true, resume: false, image: false, audio: false, embeddedContext: false, additionalDirectories: false, mcpHttp: true },
    controls: { modelId: "first", modelConfigId: null, models: [{ modelId: "first", name: "First model" }, { modelId: "chosen", name: "Chosen model" }] },
    ...overrides,
  };
}

export function event(sequence: number, kind: string, data: Record<string, unknown>, sessionId = "saved"): AcpEvent {
  return { sequence, kind, data, sessionId, projectId: "paper", agentId: "fixture", modelId: "first", taskId: null, turnId: "turn", timestamp: sequence };
}

function openedListbox(trigger: HTMLElement): HTMLElement | null {
  const controlled = trigger.getAttribute("aria-controls");
  if (!controlled) return trigger.ownerDocument.querySelector<HTMLElement>('[role="listbox"]');
  const element = trigger.ownerDocument.getElementById(controlled);
  if (!element || element.getAttribute("role") === "listbox") return element;
  return element.querySelector<HTMLElement>('[role="listbox"]');
}

export async function chooseOption(trigger: HTMLElement, option: string | RegExp) {
  const { fireEvent, waitFor, within } = await testingLibrary();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const listbox = await waitFor(() => {
    const found = openedListbox(trigger);
    if (!found) throw new Error("The dropdown did not open.");
    return found;
  });
  const item = within(listbox).getByRole("option", { name: option });
  fireEvent.click(item, { button: 0 });
}

export async function optionNames(trigger: HTMLElement): Promise<string[]> {
  const { fireEvent, waitFor, within } = await testingLibrary();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const listbox = await waitFor(() => {
    const found = openedListbox(trigger);
    if (!found) throw new Error("The dropdown did not open.");
    return found;
  });
  const names = within(listbox)
    .queryAllByRole("option")
    .map((item) => (item.textContent ?? "").trim());
  fireEvent.keyDown(listbox, { key: "Escape" });
  await waitFor(() => {
    if (openedListbox(trigger)) throw new Error("The dropdown did not close.");
  });
  return names;
}

async function openMenu(trigger: HTMLElement): Promise<HTMLElement> {
  const { fireEvent, waitFor } = await testingLibrary();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return await waitFor(() => {
    const found = trigger.ownerDocument.querySelector<HTMLElement>('[role="menu"]');
    if (!found) throw new Error("The menu did not open.");
    return found;
  });
}

export async function chooseMenuItem(trigger: HTMLElement, item: string | RegExp) {
  const { act, fireEvent, within } = await testingLibrary();
  const menu = await openMenu(trigger);
  const choice = within(menu).getByRole("menuitem", { name: item });
  await act(async () => {
    fireEvent.click(choice, { button: 0 });
  });
}

export async function menuItemNames(trigger: HTMLElement): Promise<string[]> {
  const { fireEvent, waitFor, within } = await testingLibrary();
  const menu = await openMenu(trigger);
  const names = within(menu)
    .queryAllByRole("menuitem")
    .map((item) => (item.textContent ?? "").trim());
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => {
    if (trigger.ownerDocument.querySelector('[role="menu"]')) {
      throw new Error("The menu did not close.");
    }
  });
  return names;
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred promise is not initialized"); };
  let reject: (reason: unknown) => void = () => { throw new Error("Deferred promise is not initialized"); };
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

export function choice(value: string, name: string, extra: Partial<AcpSelectChoice> = {}): AcpSelectChoice {
  return { value, name, description: null, group: null, blocked: false, ...extra };
}

export function selectOption(id: string, name: string, category: string | null, current: string | null, choices: AcpSelectChoice[]): AcpConfigOption {
  return { id, name, description: null, category, kind: { type: "select", currentValue: current, options: choices } };
}

export function booleanOption(id: string, name: string, category: string | null, on: boolean): AcpConfigOption {
  return { id, name, description: null, category, kind: { type: "boolean", currentValue: on } };
}

/** The options claude-agent-acp 0.93.0 reports. */
export function claudeOptions(): AcpConfigOption[] {
  return [
    selectOption("model", "Model", "model", "default", [
      choice("default", "Default (recommended)"), choice("opus", "Opus"), choice("sonnet", "Sonnet"), choice("haiku", "Haiku"),
    ]),
    booleanOption("fast", "Fast", "model_config", false),
    selectOption("effort", "Effort", "thought_level", "medium", [
      choice("low", "Low"), choice("medium", "Medium"), choice("high", "High"), choice("max", "Max"),
    ]),
    selectOption("mode", "Mode", "mode", "default", [
      choice("default", "Default"), choice("acceptEdits", "Accept edits"), choice("plan", "Plan"),
      choice("bypassPermissions", "Bypass permissions", { blocked: true }),
    ]),
  ];
}

/** The options codex-acp 2.2.2 reports. */
export function codexOptions(): AcpConfigOption[] {
  return [
    selectOption("model", "Model", "model", "gpt-5.5", [
      choice("gpt-5.5", "GPT-5.5", { group: "OpenAI" }), choice("gpt-5.5-mini", "GPT-5.5 mini", { group: "OpenAI" }),
    ]),
    selectOption("reasoning_effort", "Reasoning effort", "thought_level", "medium", [
      choice("minimal", "Minimal"), choice("low", "Low"), choice("medium", "Medium"), choice("high", "High"),
    ]),
    selectOption("mode", "Approval preset", "mode", "auto", [
      choice("read-only", "Read only"), choice("auto", "Auto"), choice("full-access", "Full access", { blocked: true }),
    ]),
  ];
}

/** gemini 0.64.0 reports models and modes the pre-config way. */
export function geminiControls(): AcpSession["controls"] {
  const modes: AcpModeOption[] = [
    { id: "default", name: "Default", description: null, blocked: false },
    { id: "plan", name: "Plan", description: "Read only", blocked: false },
    { id: "yolo", name: "YOLO", description: null, blocked: true },
  ];
  return {
    models: [{ modelId: "gemini-3-pro", name: "Gemini 3 Pro" }, { modelId: "gemini-3-flash", name: "Gemini 3 Flash" }],
    modelId: "gemini-3-pro",
    modelConfigId: null,
    options: [],
    modes,
    modeId: "default",
    legacyModels: true,
  };
}

export function piControls(): AcpSession["controls"] {
  const models = [
    ["openai-codex/gpt-5.3-codex-spark", "openai-codex/GPT-5.3 Codex Spark"],
    ["openai-codex/gpt-5.4", "openai-codex/GPT-5.4"],
    ["openai-codex/gpt-5.4-mini", "openai-codex/GPT-5.4 mini"],
    ["openai-codex/gpt-5.5", "openai-codex/GPT-5.5"],
    ["openai-codex/gpt-5.6-luna", "openai-codex/GPT-5.6 Luna"],
    ["openai-codex/gpt-5.6-sol", "openai-codex/GPT-5.6 Sol"],
    ["openai-codex/gpt-5.6-terra", "openai-codex/GPT-5.6 Terra"],
    ["openai-codex/gpt-6-astra", "openai-codex/GPT-6 Astra"],
  ];
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh"];
  return {
    models: models.map(([modelId, name]) => ({ modelId, name })),
    modelId: "openai-codex/gpt-5.5",
    modelConfigId: "model",
    options: [
      selectOption("model", "Model", "model", "openai-codex/gpt-5.5", models.map(([value, name]) => choice(value, name))),
      selectOption("thought_level", "Thinking", "thought_level", "medium", levels.map((level) => choice(level, `Thinking: ${level}`))),
    ],
    modes: levels.map((level) => ({ id: level, name: `Thinking: ${level}`, description: null, blocked: false })),
    modeId: "medium",
    legacyModels: false,
  };
}
