import { Root } from "../../node_modules/.bun/@types_hast@3.0.5/node_modules/@types/hast/index.mjs";
//#region src/Markdown/plugins/rehypeStreamAnimated.d.ts
interface StreamAnimatedRuntime {
  births: number[];
  /**
   * Write-once per-char render cache, indexed like `births`:
   * `undefined` = char not rendered yet, `null` = born fully revealed,
   * string = inline style frozen at first render.
   * Freezing the style keeps span props referentially stable across the
   * tail block's re-renders, so React never rewrites `animation-delay`
   * on an in-flight fade (a rewrite restarts the CSS animation).
   */
  styles: (string | null | undefined)[];
}
interface StreamAnimatedOptions {
  births?: number[];
  fadeDuration?: number;
  /**
   * `'word'` wraps whitespace-delimited runs in one span instead of one
   * span per char. Every concurrent CSS animation keeps the compositor
   * producing frames and fires animationstart/end through React's root
   * event delegation, so animating ~5x fewer nodes is the main CPU lever —
   * char-level remains available for the finer-grained look.
   */
  granularity?: 'char' | 'word';
  nowMs?: number;
  revealed?: boolean;
  runtime?: StreamAnimatedRuntime;
}
declare const rehypeStreamAnimated: (options?: StreamAnimatedOptions) => (tree: Root) => void;
//#endregion
export { StreamAnimatedOptions, StreamAnimatedRuntime, rehypeStreamAnimated };
//# sourceMappingURL=rehypeStreamAnimated.d.mts.map