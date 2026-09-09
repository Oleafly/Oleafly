// Static Vite client for browser tests: retain CSS imports without hot-reload sockets.
export const VITE_CLIENT_WITHOUT_TRANSPORT = String.raw`
const styles = new Map();
const ElementBase = globalThis.HTMLElement ?? class {};
export class ErrorOverlay extends ElementBase {}
export function createHotContext() {
  return {
    accept() {},
    acceptExports() {},
    decline() {},
    dispose() {},
    invalidate() {},
    on() {},
    off() {},
    prune() {},
    send() {},
  };
}
export function updateStyle(id, content) {
  let style = styles.get(id);
  if (!style) {
    style = document.createElement("style");
    style.dataset.viteDevId = id;
    document.head.appendChild(style);
    styles.set(id, style);
  }
  style.textContent = content;
}
export function removeStyle(id) {
  styles.get(id)?.remove();
  styles.delete(id);
}
export function injectQuery(url) { return url; }
`;
