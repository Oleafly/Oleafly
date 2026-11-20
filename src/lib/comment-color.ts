export const COMMENT_COLORS = ["indigo", "graphite", "leaf", "accent"] as const;

export type CommentColor = (typeof COMMENT_COLORS)[number];

export const COMMENT_COLOR_STORAGE_KEY = "oleafly.commentColor";

export function readCommentColor(value: unknown): CommentColor {
  return COMMENT_COLORS.find((color) => color === value) ?? "indigo";
}

const WARM_HUES: readonly [number, number] = [50, 110];
const GREY_CHROMA = 0.03;
const OKLCH = /^oklch\((.*)\)$/u;

function warmAccent(oklch: string): boolean {
  const call = OKLCH.exec(oklch.trim().toLowerCase());
  if (!call) return false;
  const [, chroma = 0, hue = 0] = call[1].trim().split(/[\s/]+/u).map((part) => Number.parseFloat(part) || 0);
  return chroma > GREY_CHROMA && hue >= WARM_HUES[0] && hue <= WARM_HUES[1];
}

function accentFits(root: HTMLElement): boolean {
  const probe = document.createElement("span");
  probe.style.color = "color-mix(in oklch, var(--primary), var(--primary))";
  root.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return !warmAccent(resolved);
}

let watcher: MutationObserver | null = null;

export function applyCommentColor(color: CommentColor): void {
  const root = document.documentElement;
  watcher?.disconnect();
  watcher = null;
  if (color === "accent" || color === "indigo") delete root.dataset.commentColor;
  else root.dataset.commentColor = color;
  if (color !== "accent") return;
  const check = () => {
    if (accentFits(root)) root.dataset.commentColor = "accent";
    else delete root.dataset.commentColor;
  };
  check();
  if (typeof MutationObserver === "undefined") return;
  watcher = new MutationObserver(check);
  watcher.observe(root, { attributes: true, attributeFilter: ["style", "class"] });
}
