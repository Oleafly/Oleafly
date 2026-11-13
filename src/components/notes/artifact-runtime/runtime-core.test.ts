// @vitest-environment jsdom
import type { JSDOM } from "jsdom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import { transform } from "sucrase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createArtifactRuntime,
  errorPanel,
  esm,
  fillMessage,
  MissingImportError,
  MODULE_HOOK,
  moduleScript,
  type RuntimeDeps,
  type TransformOptions,
} from "./runtime-core";

const MESSAGES = {
  unknownImport: "Imports {{name}} offline",
  compileError: "Syntax problem",
  runtimeError: "Stopped",
  noComponent: "Nothing to show",
};

function compile(code: string, options: TransformOptions): string {
  const transforms: ("jsx" | "typescript" | "imports")[] = ["jsx"];
  if (options.typescript) transforms.push("typescript");
  if (options.imports) transforms.push("imports");
  return transform(code, { transforms, jsxRuntime: options.jsx, production: true }).code;
}

function runtime(overrides: Partial<RuntimeDeps> = {}) {
  const evaluate = vi.fn((code: string) => {
    new Function(code)();
  });
  const made = createArtifactRuntime({
    React,
    createRoot,
    modules: {
      react: () => esm(React),
      "react/jsx-runtime": () => esm(JsxRuntime),
      lodash: () => esm({ sum: (values: number[]) => values.reduce((a, b) => a + b, 0) }),
    },
    subpath: (name) => (name === "lodash/sum" ? { __esModule: true, default: () => 6 } : undefined),
    globals: { Answer: () => 42 },
    transform: compile,
    tailwindSource: "globalThis.__tailwindRuns = (globalThis.__tailwindRuns ?? 0) + 1;",
    evaluate,
    ...overrides,
  });
  return { made, evaluate };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const windowListeners: [string, EventListenerOrEventListenerObject][] = [];
let addWindowListener: typeof window.addEventListener;

beforeEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(globalThis, "__tailwindRuns");
  Reflect.deleteProperty(globalThis, "Answer");
  addWindowListener = window.addEventListener;
  window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    windowListeners.push([type, listener]);
    addWindowListener.call(window, type, listener, options);
  }) as typeof window.addEventListener;
});

afterEach(() => {
  window.addEventListener = addWindowListener;
  for (const [type, listener] of windowListeners.splice(0)) window.removeEventListener(type, listener);
  vi.restoreAllMocks();
});

describe("runtime helpers", () => {
  it("wraps modules with an ES module default", () => {
    expect(esm({ a: 1 })).toEqual({ a: 1, __esModule: true, default: { a: 1 } });
    expect(esm({ a: 1, default: 2 }).default).toBe(2);
    expect(esm({ a: 1 }, "x").default).toBe("x");
    expect(fillMessage("Imports {{name}} and {{name}}", "three")).toBe("Imports three and three");
    expect(new MissingImportError("x").specifier).toBe("x");
  });

  it("draws an error panel with an optional detail", () => {
    const panel = errorPanel("Title", "x".repeat(5000));
    expect(panel.getAttribute("role")).toBe("alert");
    expect(panel.querySelector("p")?.textContent).toBe("Title");
    expect(panel.querySelector("pre")?.textContent).toHaveLength(4000);
    expect(errorPanel("Only", "").querySelector("pre")).toBeNull();
  });
});

describe("createArtifactRuntime", () => {
  it("exposes globals by name, starts Tailwind once and ignores unknown names", () => {
    const { made, evaluate } = runtime();
    made.expose(["Answer", "tailwind", "Unknown", "tailwind"]);
    expect((globalThis as Record<string, unknown>).Answer).toBe(42);
    expect((globalThis as Record<string, unknown>).Unknown).toBeUndefined();
    made.tailwind();
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect((globalThis as Record<string, unknown>).__tailwindRuns).toBe(1);
  });

  it("renders the default export with hooks and modules", async () => {
    const { made } = runtime();
    await act(async () => {
      made.runReact(
        `import { useState } from "react";
import _ from "lodash";
import sum from "lodash/sum";
export default function App() {
  const [count] = useState(_.sum([1, 2]));
  return <p id="out">{count} {sum()}</p>;
}`,
        MESSAGES,
      );
    });
    expect(document.getElementById("out")?.textContent).toBe("3 6");
  });

  it("reuses the root element when the page has one and falls back to a capitalised export", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    const { made } = runtime();
    await act(async () => {
      made.runReact('export function Chart() { return <span id="named">named</span>; }', MESSAGES);
    });
    expect(root.querySelector("#named")).not.toBeNull();
  });

  it("explains imports that are not available offline", () => {
    const { made } = runtime();
    made.runReact('import * as THREE from "three";\nexport default () => <p>{String(THREE)}</p>;', MESSAGES);
    expect(document.querySelector("[data-artifact-error]")?.textContent).toContain("Imports three offline");
  });

  it("shows compile errors, missing components and thrown errors", async () => {
    const broken = runtime().made;
    broken.runReact("export default function (", MESSAGES);
    expect(document.querySelector("[data-artifact-error] p")?.textContent).toBe("Syntax problem");
    document.body.innerHTML = "";
    runtime().made.runReact("export const value = 1;", MESSAGES);
    expect(document.querySelector("[data-artifact-error] p")?.textContent).toBe("Nothing to show");
    document.body.innerHTML = "";
    runtime().made.runReact('throw new Error("top level");', MESSAGES);
    expect(document.querySelector("[data-artifact-error] pre")?.textContent).toBe("top level");
    document.body.innerHTML = "";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      runtime().made.runReact('export default function App() { throw new Error("render failed"); }', MESSAGES);
    });
    expect(document.querySelector("[data-artifact-error] p")?.textContent).toBe("Stopped");
    expect(document.querySelector("[data-artifact-error] pre")?.textContent).toBe("render failed");
  });

  it("shows a boundary error without detail for an import that fails while rendering", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { made } = runtime();
    await act(async () => {
      made.runReact('export default function App() { return require("three").Scene; }', MESSAGES);
    });
    expect(document.querySelector("[data-artifact-error] p")?.textContent).toBe("Imports three offline");
    expect(document.querySelector("[data-artifact-error] pre")).toBeNull();
    document.body.innerHTML = "";
    await act(async () => {
      runtime().made.runReact('export default function App() { throw Object.assign(new Error(""), { name: "Odd" }); }', MESSAGES);
    });
    expect(document.querySelector("[data-artifact-error] pre")?.textContent).toBe("Odd");
    document.body.innerHTML = "";
    await act(async () => {
      runtime().made.runReact('export default function App() { throw "text"; }', MESSAGES);
    });
    expect(document.querySelector("[data-artifact-error] pre")?.textContent).toBe("text");
  });

  it("shows uncaught errors and rejections in a banner", async () => {
    const { made } = runtime();
    await act(async () => {
      made.runReact("export default () => <p>ok</p>;", MESSAGES);
    });
    const banners = () => [...document.querySelectorAll("body > [data-artifact-error]")];
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("late") }));
    const count = banners().length;
    expect(banners().at(-1)?.querySelector("pre")?.textContent).toBe("late");
    window.dispatchEvent(new ErrorEvent("error", { message: "plain message" }));
    expect(banners()).toHaveLength(count);
    expect(banners().at(-1)?.querySelector("pre")?.textContent).toBe("plain message");
    const rejection = new Event("unhandledrejection") as Event & { reason: unknown };
    rejection.reason = new MissingImportError("plotly");
    window.dispatchEvent(rejection);
    expect(banners().at(-1)?.querySelector("p")?.textContent).toBe("Imports plotly offline");
    await settle();
  });

  it("runs Babel-style scripts in order with the classic JSX runtime", () => {
    (globalThis as Record<string, unknown>).React = React;
    document.body.innerHTML =
      '<script type="text/babel">globalThis.__first = React.createElement("b").type;</script>' +
      '<script type="text/babel" data-presets="typescript">const typed: number = 2; globalThis.__second = typed;</script>' +
      '<script type="text/jsx">globalThis.__third = <i />.type;</script>' +
      '<script type="text/babel">this is not code</script>';
    const { made } = runtime();
    made.runScripts(MESSAGES);
    expect((globalThis as Record<string, unknown>).__first).toBe("b");
    expect((globalThis as Record<string, unknown>).__second).toBe(2);
    expect((globalThis as Record<string, unknown>).__third).toBe("i");
    expect([...document.querySelectorAll("body > [data-artifact-error] p")].at(-1)?.textContent).toBe("Stopped");
    for (const name of ["React", "__first", "__second", "__third"]) Reflect.deleteProperty(globalThis, name);
  });

  it("runs scripts through a script element by default and reads empty script bodies", () => {
    document.body.innerHTML = '<script type="text/babel"></script>';
    const appended: string[] = [];
    const append = vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      for (const node of nodes) appended.push((node as HTMLScriptElement).textContent ?? "");
    });
    const made = createArtifactRuntime({
      React,
      createRoot,
      modules: {},
      globals: {},
      transform: (code) => `compiled:${code}`,
      tailwindSource: "TAILWIND",
    });
    made.runScripts(MESSAGES);
    made.tailwind();
    expect(appended).toEqual(["compiled:", "TAILWIND"]);
    append.mockRestore();
    expect(() => made.runReact('import x from "nothing"; export default x;', MESSAGES)).not.toThrow();
  });
});

describe("React modules in a script element", () => {
  const frameGlobal = () => (globalThis as unknown as { jsdom: JSDOM }).jsdom.window as unknown as Record<string, unknown>;

  beforeEach(() => {
    Object.defineProperty(frameGlobal(), MODULE_HOOK, {
      configurable: true,
      get: () => (globalThis as Record<string, unknown>)[MODULE_HOOK],
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(frameGlobal(), MODULE_HOOK);
  });

  const scripted = () => {
    const appended: string[] = [];
    vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      for (const node of nodes) appended.push((node as HTMLScriptElement).textContent ?? "");
      Element.prototype.append.apply(document.head, nodes);
    });
    const made = createArtifactRuntime({
      React,
      createRoot,
      modules: { react: () => esm(React), "react/jsx-runtime": () => esm(JsxRuntime) },
      globals: {},
      transform: compile,
      tailwindSource: "",
    });
    return { made, appended };
  };

  const banners = () => document.querySelectorAll("body > [data-artifact-error]");

  it("wraps the compiled module in a function that takes require, module, exports and React", () => {
    expect(moduleScript("exports.x = 1;")).toBe(`${MODULE_HOOK}(function (require, module, exports, React) {\nexports.x = 1;\n});`);
  });

  it("renders the module's component and removes the hook once it ran", async () => {
    const { made, appended } = scripted();
    await act(async () => {
      made.runReact(
        'import { useState } from "react";\nexport default function App() { const [n] = useState(2); return <p id="out">{n} {typeof React}</p>; }',
        MESSAGES,
      );
    });
    expect(appended.at(-1)).toContain(`${MODULE_HOOK}(function (require, module, exports, React) {`);
    expect(document.getElementById("out")?.textContent).toBe("2 object");
    expect(MODULE_HOOK in globalThis).toBe(false);
  });

  it("shows what the module threw in place of the component, without a banner", () => {
    scripted().made.runReact('throw new Error("top level");', MESSAGES);
    expect(document.querySelector("#root > [data-artifact-error] p")?.textContent).toBe("Stopped");
    expect(document.querySelector("#root > [data-artifact-error] pre")?.textContent).toContain("top level");
    document.body.innerHTML = "";
    scripted().made.runReact('import * as THREE from "three";\nexport default () => String(THREE);', MESSAGES);
    expect(document.querySelector("#root > [data-artifact-error] p")?.textContent).toBe("Imports three offline");
    expect(banners()).toHaveLength(0);
    expect(MODULE_HOOK in globalThis).toBe(false);
  });

  it("shows a script that fails to parse as a runtime error, without a banner", () => {
    scripted().made.runReact("let twice = 1;\nlet twice = 2;\nexport default () => twice;", MESSAGES);
    expect(document.querySelector("#root > [data-artifact-error] p")?.textContent).toBe("Stopped");
    expect(document.querySelector("#root > [data-artifact-error] pre")?.textContent).toContain("twice");
    expect(banners()).toHaveLength(0);
    expect(MODULE_HOOK in globalThis).toBe(false);
  });

  it("still shows later uncaught errors in a banner", async () => {
    const { made } = scripted();
    await act(async () => {
      made.runReact("export default () => <p>ok</p>;", MESSAGES);
    });
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("later") }));
    expect(banners()).toHaveLength(1);
    expect(banners()[0].querySelector("pre")?.textContent).toBe("later");
    await settle();
  });
});
