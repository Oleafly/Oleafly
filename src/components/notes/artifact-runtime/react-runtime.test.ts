// @vitest-environment jsdom
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { artifactRuntime, lodashSubpath, RUNTIME_GLOBALS, RUNTIME_MODULES, transformCode } from "./react-runtime";

describe("artifact runtime bundle", () => {
  it("installs itself as the frame global", () => {
    expect((globalThis as Record<string, unknown>).__oleaflyArtifact).toBe(artifactRuntime);
  });

  it("transforms JSX, TypeScript and imports as asked", () => {
    const modern = transformCode('import { useState } from "react";\nconst n: number = 1;\nexport default () => <b>{useState(n)[0]}</b>;', {
      jsx: "automatic",
      typescript: true,
      imports: true,
    });
    expect(modern).toMatch(/require\(['"]react['"]\)/u);
    expect(modern).toContain("react/jsx-runtime");
    expect(modern).not.toContain(": number");
    const classic = transformCode("const a = <i />;", { jsx: "classic", typescript: false, imports: false });
    expect(classic).toContain("React.createElement");
    expect(classic).not.toContain("require(");
  });

  it("offers every bundled module with an ES default", () => {
    for (const [name, load] of Object.entries(RUNTIME_MODULES)) {
      const module = load();
      expect(module.__esModule, name).toBe(true);
      expect(module.default, name).toBeDefined();
    }
    expect(typeof RUNTIME_MODULES["chart.js"]().Chart).toBe("function");
    expect(RUNTIME_MODULES["chart.js/auto"]().default).toBe(RUNTIME_MODULES["chart.js"]().default);
    expect(typeof RUNTIME_MODULES.lodash().default).toBe("function");
    expect(typeof RUNTIME_MODULES.papaparse().parse).toBe("function");
  });

  it("resolves lodash function paths and nothing else", () => {
    expect(typeof lodashSubpath("lodash/debounce")?.default).toBe("function");
    expect(typeof lodashSubpath("lodash-es/sum.js")?.default).toBe("function");
    expect(lodashSubpath("lodash/VERSION")).toBeUndefined();
    expect(lodashSubpath("lodash/notAFunction")).toBeUndefined();
    expect(lodashSubpath("three")).toBeUndefined();
  });

  it("gives pages UMD-style globals, including the old ReactDOM.render", async () => {
    for (const load of Object.values(RUNTIME_GLOBALS)) expect(load()).toBeDefined();
    const ReactDOM = RUNTIME_GLOBALS.ReactDOM() as {
      render: (element: unknown, target: Element) => void;
      unmountComponentAtNode: (target: Element) => boolean;
    };
    const target = document.createElement("div");
    await act(async () => ReactDOM.render(createElement("em", null, "one"), target));
    await act(async () => ReactDOM.render(createElement("em", null, "two"), target));
    expect(target.textContent).toBe("two");
    await act(async () => {
      expect(ReactDOM.unmountComponentAtNode(target)).toBe(true);
    });
    expect(ReactDOM.unmountComponentAtNode(document.createElement("div"))).toBe(false);
    const Babel = RUNTIME_GLOBALS.Babel() as { transform: (code: string, options?: { presets?: string[] }) => { code: string } };
    expect(Babel.transform("const a: number = <b />;", { presets: ["react", "typescript"] }).code).toContain("React.createElement");
    expect(Babel.transform("<b />").code).toContain("React.createElement");
    expect(RUNTIME_GLOBALS.Chart()).toBe(RUNTIME_GLOBALS.Chart());
  });
});
