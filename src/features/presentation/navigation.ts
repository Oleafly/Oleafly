export type SlideAction = "next" | "previous" | "first" | "last" | "end" | "blank";

export type PresentationSource = { readonly kind: "compiled" } | { readonly kind: "file"; readonly path: string };

export interface PresentationParams {
  readonly session: string;
  readonly projectId: string;
  readonly source: PresentationSource;
  readonly start: number;
  readonly presenter: boolean;
  readonly main: string | null;
  readonly typst: boolean;
  readonly variant?: string | null;
  readonly offline?: boolean;
}

export type PresentationView = "present" | "presenter";

export const PRESENTATION_WINDOW = "presentation";
export const PRESENTER_WINDOW = "presenter";

export const PRESENTATION_EVENTS = {
  goto: "presentation:goto",
  blank: "presentation:blank",
  end: "presentation:end",
} as const;

const KEY_ACTIONS: Readonly<Record<string, SlideAction>> = {
  ArrowRight: "next",
  ArrowDown: "next",
  PageDown: "next",
  " ": "next",
  Spacebar: "next",
  Enter: "next",
  n: "next",
  N: "next",
  ArrowLeft: "previous",
  ArrowUp: "previous",
  PageUp: "previous",
  Backspace: "previous",
  p: "previous",
  P: "previous",
  Home: "first",
  End: "last",
  Escape: "end",
  b: "blank",
  B: "blank",
  ".": "blank",
};

const MAX_PARAM_LENGTH = 4_096;

export function slideActionForKey(event: {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}): SlideAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return KEY_ACTIONS[event.key] ?? null;
}

export function clampSlide(page: number, total: number): number {
  if (total < 1) return 1;
  return Math.min(total, Math.max(1, Math.round(page)));
}

export function applySlideAction(action: SlideAction, page: number, total: number): number {
  switch (action) {
    case "next":
      return clampSlide(page + 1, total);
    case "previous":
      return clampSlide(page - 1, total);
    case "first":
      return 1;
    case "last":
      return clampSlide(total, total);
    default:
      return clampSlide(page, total);
  }
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function presentationQuery(params: PresentationParams, view: PresentationView): URLSearchParams {
  const query = new URLSearchParams({
    view,
    session: params.session,
    project: params.projectId,
    source: params.source.kind,
    start: String(params.start),
    presenter: params.presenter ? "1" : "0",
    typst: params.typst ? "1" : "0",
  });
  if (params.source.kind === "file") query.set("path", params.source.path);
  if (params.main) query.set("main", params.main);
  if (params.variant) query.set("variant", params.variant);
  if (params.offline) query.set("offline", "1");
  return query;
}

function bounded(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed && trimmed.length <= MAX_PARAM_LENGTH ? trimmed : null;
}

export function readPresentationParams(search: string): PresentationParams | null {
  const query = new URLSearchParams(search);
  const session = bounded(query.get("session"));
  const projectId = bounded(query.get("project"));
  if (!session || !projectId) return null;
  let source: PresentationSource = { kind: "compiled" };
  if (query.get("source") === "file") {
    const path = bounded(query.get("path"));
    if (!path) return null;
    source = { kind: "file", path };
  }
  const start = Number.parseInt(query.get("start") ?? "1", 10);
  const variant = bounded(query.get("variant"));
  return {
    session,
    projectId,
    source,
    start: Number.isFinite(start) && start > 0 ? start : 1,
    presenter: query.get("presenter") === "1",
    main: bounded(query.get("main")),
    typst: query.get("typst") === "1",
    ...(variant ? { variant } : {}),
    ...(query.get("offline") === "1" ? { offline: true } : {}),
  };
}
