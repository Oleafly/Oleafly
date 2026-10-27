import type * as MathRender from "./math-render";

export type MathRenderModule = typeof MathRender;

// KaTeX is a quarter of a megabyte and is needed only once a formula is
// previewed, so the source editor loads math-render on first use rather than
// with the app. After that load, previews render synchronously as before.
let loaded: MathRenderModule | null = null;
let loading: Promise<MathRenderModule> | null = null;

export function loadMathRender(): Promise<MathRenderModule> {
  loading ??= import("./math-render").then(
    (module) => {
      loaded = module;
      return module;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

export function loadedMathRender(): MathRenderModule | null {
  return loaded;
}
