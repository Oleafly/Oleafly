import { JSDOM } from "jsdom";
import type { AcpAgentStatus, AcpEvent, AcpSession } from "@/lib/acp";

export function installUiDom() {
  const options = { url: "https://oleafly.test", pretendToBeVisual: true };
  const dom = new JSDOM("<!doctype html><html><body></body></html>", options);
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver,
    FileReader: dom.window.FileReader, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} }, detachEvent: { configurable: true, value: () => {} },
  });
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

export function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred promise is not initialized"); };
  let reject: (reason: unknown) => void = () => { throw new Error("Deferred promise is not initialized"); };
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
