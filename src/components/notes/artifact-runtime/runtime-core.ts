import type * as ReactTypes from "react";
import type { Root } from "react-dom/client";

export type RuntimeModule = Record<string, unknown>;

export interface RuntimeMessages {
  unknownImport: string;
  compileError: string;
  runtimeError: string;
  noComponent: string;
}

export interface TransformOptions {
  jsx: "automatic" | "classic";
  typescript: boolean;
  imports: boolean;
}

export interface RuntimeDeps {
  React: typeof ReactTypes;
  createRoot: (container: Element) => Root;
  modules: Readonly<Record<string, () => RuntimeModule>>;
  subpath?: (specifier: string) => RuntimeModule | undefined;
  globals: Readonly<Record<string, () => unknown>>;
  transform: (code: string, options: TransformOptions) => string;
  tailwindSource: string;
  evaluate?: (code: string) => void;
}

export interface ArtifactRuntime {
  expose: (names: readonly string[]) => void;
  tailwind: () => void;
  runReact: (code: string, messages: RuntimeMessages) => void;
  runScripts: (messages: RuntimeMessages) => void;
}

export class MissingImportError extends Error {
  readonly specifier: string;

  constructor(specifier: string) {
    super(specifier);
    this.name = "MissingImportError";
    this.specifier = specifier;
  }
}

export function esm(namespace: object, fallback?: unknown): RuntimeModule {
  const record = namespace as RuntimeModule;
  const preferred = fallback ?? ("default" in record && record.default !== undefined ? record.default : namespace);
  return { ...record, __esModule: true, default: preferred };
}

export function fillMessage(template: string, name: string): string {
  return template.replaceAll("{{name}}", name);
}

const MAX_DETAIL = 4000;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export function errorPanel(title: string, detail: string): HTMLElement {
  const panel = document.createElement("div");
  panel.setAttribute("role", "alert");
  panel.dataset.artifactError = "";
  panel.style.cssText =
    "margin:12px;padding:10px 12px;border-radius:8px;border:1px solid rgba(220,38,38,.35);background:rgba(220,38,38,.08);font:13px/1.5 system-ui,sans-serif;color:inherit";
  const heading = document.createElement("p");
  heading.style.cssText = "margin:0 0 4px;font-weight:600;color:#dc2626";
  heading.textContent = title;
  panel.append(heading);
  if (detail) {
    const body = document.createElement("pre");
    body.style.cssText = "margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace";
    body.textContent = detail.slice(0, MAX_DETAIL);
    panel.append(body);
  }
  return panel;
}

function pickComponent(exports: RuntimeModule): unknown {
  const preferred = exports.default;
  if (typeof preferred === "function" || (typeof preferred === "object" && preferred !== null)) return preferred;
  for (const [name, value] of Object.entries(exports)) {
    if (/^[A-Z]/u.test(name) && typeof value === "function") return value;
  }
  return null;
}

function container(): HTMLElement {
  const existing = document.getElementById("root");
  if (existing) return existing;
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  return root;
}

export function runScript(code: string): void {
  const script = document.createElement("script");
  script.textContent = code;
  document.head.append(script);
  script.remove();
}

export const MODULE_HOOK = "__oleaflyArtifactModule";

type ModuleFactory = (
  require: (specifier: string) => RuntimeModule,
  module: { exports: RuntimeModule },
  exports: RuntimeModule,
  react: typeof ReactTypes,
) => void;

export function moduleScript(compiled: string): string {
  return `${MODULE_HOOK}(function (require, module, exports, React) {\n${compiled}\n});`;
}

export function createArtifactRuntime(deps: RuntimeDeps): ArtifactRuntime {
  const { React } = deps;
  const evaluate = deps.evaluate ?? runScript;
  const cache = new Map<string, RuntimeModule>();
  let tailwindStarted = false;
  let banner: HTMLElement | null = null;
  let capture: ((error: unknown) => void) | null = null;

  const requireModule = (specifier: string): RuntimeModule => {
    const cached = cache.get(specifier);
    if (cached) return cached;
    const factory = Object.hasOwn(deps.modules, specifier) ? deps.modules[specifier] : undefined;
    const loaded = factory ? factory() : deps.subpath?.(specifier);
    if (!loaded) throw new MissingImportError(specifier);
    cache.set(specifier, loaded);
    return loaded;
  };

  const tailwind = () => {
    if (tailwindStarted) return;
    tailwindStarted = true;
    evaluate(deps.tailwindSource);
  };

  const expose = (names: readonly string[]) => {
    const target = globalThis as unknown as Record<string, unknown>;
    for (const name of names) {
      if (name === "tailwind") {
        tailwind();
        continue;
      }
      if (Object.hasOwn(deps.globals, name)) target[name] = deps.globals[name]();
    }
  };

  const describe = (error: unknown, messages: RuntimeMessages): { title: string; detail: string } => {
    if (error instanceof MissingImportError) return { title: fillMessage(messages.unknownImport, error.specifier), detail: "" };
    return { title: messages.runtimeError, detail: errorText(error) };
  };

  const showBanner = (error: unknown, messages: RuntimeMessages) => {
    const { title, detail } = describe(error, messages);
    banner?.remove();
    banner = errorPanel(title, detail);
    document.body.append(banner);
  };

  const listen = (messages: RuntimeMessages) => {
    window.addEventListener("error", (event) => {
      const error = event.error ?? event.message;
      if (capture === null) {
        showBanner(error, messages);
        return;
      }
      event.preventDefault();
      capture(error);
    });
    window.addEventListener("unhandledrejection", (event) => showBanner(event.reason, messages));
  };

  const loadModule = (compiled: string): RuntimeModule => {
    const module = { exports: {} as RuntimeModule };
    const failure = { failed: false, error: undefined as unknown };
    const fail = (error: unknown) => {
      if (failure.failed) return;
      failure.failed = true;
      failure.error = error;
    };
    const hooks = globalThis as unknown as Record<string, unknown>;
    hooks[MODULE_HOOK] = (factory: ModuleFactory) => {
      Reflect.deleteProperty(hooks, MODULE_HOOK);
      try {
        factory(requireModule, module, module.exports, React);
      } catch (error) {
        fail(error);
      }
    };
    capture = fail;
    try {
      evaluate(moduleScript(compiled));
    } catch (error) {
      fail(error);
    } finally {
      capture = null;
      Reflect.deleteProperty(hooks, MODULE_HOOK);
    }
    if (failure.failed) throw failure.error;
    return module.exports;
  };

  const makeBoundary = (messages: RuntimeMessages) =>
    class Boundary extends React.Component<{ children?: ReactTypes.ReactNode }, { error: unknown }> {
      state = { error: null as unknown };

      static getDerivedStateFromError(error: unknown) {
        return { error };
      }

      render() {
        if (this.state.error === null) return this.props.children;
        const { title, detail } = describe(this.state.error, messages);
        return React.createElement(
          "div",
          { role: "alert", "data-artifact-error": "", style: { margin: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(220,38,38,.35)", background: "rgba(220,38,38,.08)", font: "13px/1.5 system-ui,sans-serif" } },
          React.createElement("p", { style: { margin: "0 0 4px", fontWeight: 600, color: "#dc2626" } }, title),
          detail
            ? React.createElement(
                "pre",
                { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", font: "12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace" } },
                detail.slice(0, MAX_DETAIL),
              )
            : null,
        );
      }
    };

  const runReact = (code: string, messages: RuntimeMessages) => {
    listen(messages);
    tailwind();
    const host = container();
    let compiled: string;
    try {
      compiled = deps.transform(code, { jsx: "automatic", typescript: true, imports: true });
    } catch (error) {
      host.replaceChildren(errorPanel(messages.compileError, errorText(error)));
      return;
    }
    let component: unknown;
    try {
      component = pickComponent(loadModule(compiled));
    } catch (error) {
      const { title, detail } = describe(error, messages);
      host.replaceChildren(errorPanel(title, detail));
      return;
    }
    if (!component) {
      host.replaceChildren(errorPanel(messages.noComponent, ""));
      return;
    }
    const Boundary = makeBoundary(messages);
    deps
      .createRoot(host)
      .render(React.createElement(Boundary, null, React.createElement(component as ReactTypes.ComponentType)));
  };

  const runScripts = (messages: RuntimeMessages) => {
    listen(messages);
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      'script[type="text/babel"], script[type="text/jsx"], script[type="text/tsx"]',
    );
    for (const script of scripts) {
      const presets = `${script.dataset.presets ?? ""} ${script.type}`;
      try {
        evaluate(
          deps.transform(script.textContent ?? "", {
            jsx: "classic",
            typescript: /typescript|tsx/u.test(presets),
            imports: false,
          }),
        );
      } catch (error) {
        showBanner(error, messages);
      }
    }
  };

  return { expose, tailwind, runReact, runScripts };
}
