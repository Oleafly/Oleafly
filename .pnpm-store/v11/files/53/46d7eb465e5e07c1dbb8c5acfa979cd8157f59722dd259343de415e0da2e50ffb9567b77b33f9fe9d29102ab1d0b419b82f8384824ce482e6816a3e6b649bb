//#region src/HtmlPreview/const.d.ts
/**
 * Default sandbox attribute for HTML preview iframes.
 *
 * Why this exact set:
 * - `allow-scripts`  — required by the use case (three.js / p5.js / Tailwind
 *   CDN style demos). Without it inline preview degrades to source view.
 * - `allow-forms`    — lets demos handle `<form>` submissions in-frame.
 * - `allow-modals`   — `alert`/`confirm`/`prompt` are common in toy demos.
 *
 * Deliberately omitted:
 * - `allow-same-origin` — would let scripts read parent cookies / localStorage
 *   under cloud deployments, and bridge the IPC boundary on desktop builds.
 * - `allow-popups`, `allow-top-navigation` — phishing surface.
 *
 * Override at your own risk via `sandbox` prop.
 */
declare const DEFAULT_SANDBOX = "allow-scripts allow-forms allow-modals";
declare const DEFAULT_HEIGHT = 400;
/**
 * Is the content a "full" HTML document (has `<html>` or `<!DOCTYPE html>`)?
 * Fragments without these markers render poorly inline and should not auto-mount.
 */
declare const isFullHtmlDocument: (content: string) => boolean;
/**
 * Heuristic for whether streaming HTML is "stable enough to mount the iframe".
 * Re-mounting srcDoc on every token reboots scripts (p5.js setup runs each
 * time), so we wait for a clear closing signal.
 */
declare const isHtmlContentClosed: (content: string) => boolean;
/**
 * Does the content contain a `<script>` tag?
 *
 * Used by `streamingMode: 'auto'` to decide whether live-streaming the
 * iframe is safe. Script-bearing content gets deferred until stable so we
 * don't re-run `setup()` on every token; script-less content (pure
 * markup + styles) streams live for a more responsive feel.
 */
declare const containsScript: (content: string) => boolean;
//#endregion
export { DEFAULT_HEIGHT, DEFAULT_SANDBOX, containsScript, isFullHtmlDocument, isHtmlContentClosed };
//# sourceMappingURL=const.d.mts.map