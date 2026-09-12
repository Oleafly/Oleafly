import { JSDOM } from "jsdom";
import { fireEvent, waitFor, within } from "@testing-library/react";
import type { AcpAgentStatus, AcpEvent, AcpSession } from "@/lib/acp";

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
  return { dom, restore: () => {
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

export async function chooseOption(trigger: HTMLElement, option: string | RegExp) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const listbox = await waitFor(() => {
    const found = trigger.ownerDocument.querySelector<HTMLElement>('[role="listbox"]');
    if (!found) throw new Error("The dropdown did not open.");
    return found;
  });
  const item = within(listbox).getByRole("option", { name: option });
  fireEvent.click(item, { button: 0 });
}

export async function optionNames(trigger: HTMLElement): Promise<string[]> {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const listbox = await waitFor(() => {
    const found = trigger.ownerDocument.querySelector<HTMLElement>('[role="listbox"]');
    if (!found) throw new Error("The dropdown did not open.");
    return found;
  });
  const names = within(listbox)
    .queryAllByRole("option")
    .map((item) => (item.textContent ?? "").trim());
  fireEvent.keyDown(listbox, { key: "Escape" });
  await waitFor(() => {
    if (trigger.ownerDocument.querySelector('[role="listbox"]')) throw new Error("The dropdown did not close.");
  });
  return names;
}

async function openMenu(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return await waitFor(() => {
    const found = trigger.ownerDocument.querySelector<HTMLElement>('[role="menu"]');
    if (!found) throw new Error("The menu did not open.");
    return found;
  });
}

export async function chooseMenuItem(trigger: HTMLElement, item: string | RegExp) {
  const menu = await openMenu(trigger);
  fireEvent.click(within(menu).getByRole("menuitem", { name: item }), { button: 0 });
}

export async function menuItemNames(trigger: HTMLElement): Promise<string[]> {
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
