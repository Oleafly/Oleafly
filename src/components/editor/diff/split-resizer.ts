const STORAGE_KEY = "oleafly.diff.splitRatio";
const MIN_RATIO = 20;
const MAX_RATIO = 80;
const KEY_STEP = 5;

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, Math.round(value)));
}

export function readSplitRatio(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return stored > 0 ? clampSplitRatio(stored) : 50;
  } catch {
    return 50;
  }
}

function writeSplitRatio(ratio: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ratio));
  } catch {
    return;
  }
}

export function attachSplitResizer(host: HTMLElement): () => void {
  const editors = host.querySelector<HTMLElement>(".cm-mergeViewEditors");
  const panes = editors ? Array.from(editors.querySelectorAll<HTMLElement>(":scope > .cm-mergeViewEditor")) : [];
  const [first, second] = panes;
  if (!editors || !first || !second) return () => {};

  let ratio = readSplitRatio();
  const handle = document.createElement("div");
  handle.className = "oleafly-diff-resizer";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize diff panes");
  handle.setAttribute("aria-valuemin", String(MIN_RATIO));
  handle.setAttribute("aria-valuemax", String(MAX_RATIO));
  handle.tabIndex = 0;
  host.style.position = "relative";
  host.appendChild(handle);

  const apply = () => {
    first.style.flex = `0 0 ${ratio}%`;
    second.style.flex = "1 1 0%";
    handle.setAttribute("aria-valuenow", String(ratio));
    const hostRect = host.getBoundingClientRect();
    const firstRect = first.getBoundingClientRect();
    const gap = second.getBoundingClientRect().left - firstRect.right;
    handle.style.left = `${firstRect.right - hostRect.left + gap / 2}px`;
  };

  const setRatio = (next: number) => {
    ratio = clampSplitRatio(next);
    apply();
    writeSplitRatio(ratio);
  };

  const onPointerMove = (event: PointerEvent) => {
    const rect = editors.getBoundingClientRect();
    if (rect.width <= 0) return;
    setRatio(((event.clientX - rect.left) / rect.width) * 100);
  };
  const onPointerUp = () => {
    handle.dataset.dragging = "false";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.dataset.dragging = "true";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") setRatio(ratio - KEY_STEP);
    else if (event.key === "ArrowRight") setRatio(ratio + KEY_STEP);
    else if (event.key === "Home") setRatio(MIN_RATIO);
    else if (event.key === "End") setRatio(MAX_RATIO);
    else return;
    event.preventDefault();
  };
  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("keydown", onKeyDown);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(apply) : null;
  observer?.observe(host);
  apply();

  return () => {
    onPointerUp();
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("keydown", onKeyDown);
    observer?.disconnect();
    handle.remove();
    first.style.flex = "";
    second.style.flex = "";
  };
}
