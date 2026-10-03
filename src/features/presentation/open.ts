import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors, currentMonitor, type Monitor } from "@tauri-apps/api/window";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import {
  PRESENTATION_WINDOW,
  PRESENTER_WINDOW,
  presentationQuery,
  type PresentationParams,
  type PresentationSource,
} from "./navigation";

export interface StartPresentationOptions {
  readonly projectId: string;
  readonly source: PresentationSource;
  readonly start?: number;
  readonly presenter: boolean;
  readonly main: string | null;
  readonly typst: boolean;
  readonly variant?: string | null;
  readonly offline?: boolean;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PRESENTER_SIZE = { width: 1280, height: 820 };
const REHEARSAL_SIZE = { width: 960, height: 540 };
const MARGIN = 40;

function logicalRect(monitor: Monitor): Rect {
  const scale = monitor.scaleFactor || 1;
  return {
    x: monitor.position.x / scale,
    y: monitor.position.y / scale,
    width: monitor.size.width / scale,
    height: monitor.size.height / scale,
  };
}

function sameMonitor(left: Monitor, right: Monitor | null): boolean {
  return right !== null && left.position.x === right.position.x && left.position.y === right.position.y;
}

export interface PresentationPlacement {
  readonly audience: Rect | null;
  readonly presenter: Rect | null;
  readonly fullscreen: boolean;
}

export function placePresentation(
  monitors: readonly Monitor[],
  current: Monitor | null,
  presenter: boolean,
): PresentationPlacement {
  const here = current ?? monitors[0] ?? null;
  const hereRect = here ? logicalRect(here) : null;
  if (!presenter) return { audience: hereRect, presenter: null, fullscreen: true };
  const other = monitors.find((monitor) => !sameMonitor(monitor, here)) ?? null;
  if (other) return { audience: logicalRect(other), presenter: hereRect, fullscreen: true };
  return { audience: hereRect, presenter: hereRect, fullscreen: false };
}

function audienceBounds(placement: PresentationPlacement) {
  const rect = placement.audience;
  if (placement.fullscreen) {
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : {};
  }
  return rect
    ? { x: rect.x + rect.width - REHEARSAL_SIZE.width - MARGIN, y: rect.y + MARGIN, ...REHEARSAL_SIZE }
    : REHEARSAL_SIZE;
}

function presenterBounds(rect: Rect | null) {
  if (!rect) return { ...PRESENTER_SIZE, center: true };
  return {
    x: rect.x + MARGIN,
    y: rect.y + MARGIN,
    width: Math.max(640, Math.min(PRESENTER_SIZE.width, rect.width - 2 * MARGIN)),
    height: Math.max(480, Math.min(PRESENTER_SIZE.height, rect.height - 2 * MARGIN)),
  };
}

async function closeWindow(label: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel(label).catch(() => null);
  if (existing) await existing.destroy().catch(() => {});
}

export async function closePresentation(): Promise<void> {
  await Promise.all([PRESENTATION_WINDOW, PRESENTER_WINDOW].map(closeWindow));
}

function watchErrors(window: WebviewWindow, scope: string): void {
  void window.once("tauri://error", (event) => void logError(scope, event.payload));
}

export async function startPresentation(options: StartPresentationOptions): Promise<PresentationParams | null> {
  if (!isTauri()) return null;
  await closePresentation();
  const params: PresentationParams = {
    session: crypto.randomUUID(),
    projectId: options.projectId,
    source: options.source,
    start: Math.max(1, Math.round(options.start ?? 1)),
    presenter: options.presenter,
    main: options.main,
    typst: options.typst,
    ...(options.variant ? { variant: options.variant } : {}),
    ...(options.offline ? { offline: true } : {}),
  };
  const [monitors, current] = await Promise.all([
    availableMonitors().catch(() => []),
    currentMonitor().catch(() => null),
  ]);
  const placement = placePresentation(monitors, current, options.presenter);
  const audience = new WebviewWindow(PRESENTATION_WINDOW, {
    url: `index.html?${presentationQuery(params, "present").toString()}`,
    title: i18n.t(($) => $.preview.presentation.windowTitle),
    fullscreen: placement.fullscreen,
    resizable: true,
    focus: !options.presenter,
    ...audienceBounds(placement),
  });
  watchErrors(audience, "presentation-window");
  if (options.presenter) {
    const presenter = new WebviewWindow(PRESENTER_WINDOW, {
      url: `index.html?${presentationQuery(params, "presenter").toString()}`,
      title: i18n.t(($) => $.preview.presentation.presenterTitle),
      resizable: true,
      focus: true,
      ...presenterBounds(placement.presenter),
    });
    watchErrors(presenter, "presenter-window");
  }
  return params;
}
