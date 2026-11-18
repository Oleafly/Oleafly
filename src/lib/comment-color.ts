export const COMMENT_COLORS = ["indigo", "graphite", "leaf", "accent"] as const;

export type CommentColor = (typeof COMMENT_COLORS)[number];

export const COMMENT_COLOR_STORAGE_KEY = "oleafly.commentColor";

export function readCommentColor(value: unknown): CommentColor {
  return COMMENT_COLORS.find((color) => color === value) ?? "indigo";
}

function storedCommentColor(): CommentColor {
  try {
    return readCommentColor(window.localStorage.getItem(COMMENT_COLOR_STORAGE_KEY));
  } catch {
    return "indigo";
  }
}

let applied = 0;
let watcher: MutationObserver | null = null;

export async function applyCommentColor(color: CommentColor = storedCommentColor()): Promise<void> {
  const root = document.documentElement;
  const turn = ++applied;
  watcher?.disconnect();
  watcher = null;
  if (color === "accent" || color === "indigo") delete root.dataset.commentColor;
  else root.dataset.commentColor = color;
  if (color !== "accent") return;
  const { accentFits } = await import("./comment-accent");
  if (turn !== applied) return;
  const check = () => {
    if (accentFits(root)) root.dataset.commentColor = "accent";
    else delete root.dataset.commentColor;
  };
  check();
  if (typeof MutationObserver === "undefined") return;
  watcher = new MutationObserver(check);
  watcher.observe(root, { attributes: true, attributeFilter: ["style", "class"] });
}
