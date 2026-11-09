import tailwindSource from "@tailwindcss/browser?raw";
import { Chart, registerables } from "chart.js";
import * as ChartModule from "chart.js";
import * as d3 from "d3";
import lodash from "lodash";
import * as Lucide from "lucide-react";
import Papa from "papaparse";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as Recharts from "recharts";
import { transform } from "sucrase";
import { createArtifactRuntime, esm, type RuntimeModule, type TransformOptions } from "./runtime-core";

let chartReady = false;

function chart(): typeof Chart {
  if (!chartReady) {
    Chart.register(...registerables);
    chartReady = true;
  }
  return Chart;
}

function reactDomGlobal(): RuntimeModule {
  const roots = new WeakMap<Element, ReactDOMClient.Root>();
  return {
    ...ReactDOM,
    ...ReactDOMClient,
    render(element: React.ReactNode, target: Element) {
      const root = roots.get(target) ?? ReactDOMClient.createRoot(target);
      roots.set(target, root);
      root.render(element);
    },
    unmountComponentAtNode(target: Element) {
      roots.get(target)?.unmount();
      return roots.delete(target);
    },
  };
}

export function transformCode(code: string, options: TransformOptions): string {
  const transforms: ("jsx" | "typescript" | "imports")[] = ["jsx"];
  if (options.typescript) transforms.push("typescript");
  if (options.imports) transforms.push("imports");
  return transform(code, {
    transforms,
    jsxRuntime: options.jsx,
    production: true,
    filePath: options.typescript ? "Artifact.tsx" : "Artifact.jsx",
  }).code;
}

const lodashModule = () => esm(lodash as unknown as object, lodash);

export const RUNTIME_MODULES: Record<string, () => RuntimeModule> = {
  react: () => esm(React),
  "react-dom": () => esm(reactDomGlobal()),
  "react-dom/client": () => esm(ReactDOMClient),
  "react/jsx-runtime": () => esm(JsxRuntime),
  "react/jsx-dev-runtime": () => esm(JsxRuntime),
  "lucide-react": () => esm(Lucide),
  recharts: () => esm(Recharts),
  d3: () => esm(d3),
  lodash: lodashModule,
  "lodash-es": lodashModule,
  papaparse: () => esm(Papa, Papa),
  "chart.js": () => esm({ ...ChartModule, Chart: chart() }, chart()),
  "chart.js/auto": () => esm({ ...ChartModule, Chart: chart() }, chart()),
};

export function lodashSubpath(specifier: string): RuntimeModule | undefined {
  const match = /^lodash(?:-es)?\/([A-Za-z]+)(?:\.js)?$/u.exec(specifier);
  if (!match) return undefined;
  const value = (lodash as unknown as Record<string, unknown>)[match[1]];
  return typeof value === "function" ? { __esModule: true, default: value } : undefined;
}

export const RUNTIME_GLOBALS: Record<string, () => unknown> = {
  React: () => React,
  ReactDOM: reactDomGlobal,
  d3: () => d3,
  _: () => lodash,
  Papa: () => Papa,
  Chart: chart,
  Recharts: () => Recharts,
  Babel: () => ({
    transform: (code: string, options?: { presets?: string[] }) => ({
      code: transformCode(code, {
        jsx: "classic",
        typescript: (options?.presets ?? []).some((preset) => /typescript/u.test(String(preset))),
        imports: false,
      }),
    }),
  }),
};

export const artifactRuntime = createArtifactRuntime({
  React,
  createRoot: ReactDOMClient.createRoot,
  modules: RUNTIME_MODULES,
  subpath: lodashSubpath,
  globals: RUNTIME_GLOBALS,
  transform: transformCode,
  tailwindSource,
});

(globalThis as unknown as Record<string, unknown>).__oleaflyArtifact = artifactRuntime;
