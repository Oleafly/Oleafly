import { appendAppLog } from "@/lib/tauri";

// Startup instrumentation: cheap performance marks at boot milestones. Dev
// builds log the derived measures once so real-machine timings accumulate in
// the app log; production pays only for the marks themselves.

export type BootStage =
  | "entry-evaluated"
  | "contributions-registered"
  | "react-mounted"
  | "stores-ready"
  | "projects-loaded";

const PREFIX = "boot:";
const SPLASH_HOLD_LIMIT_MS = 20_000;
const reported = new Set<BootStage>();
let splashHeld = false;
let splashHoldTimer: ReturnType<typeof setTimeout> | undefined;

// Index into the splash narration list (index.html): real boot progress
// advances the stage text immediately instead of waiting on the 1s fallback.
const SPLASH_STAGE_INDEX: Partial<Record<BootStage, number>> = {
  "entry-evaluated": 1,
  "contributions-registered": 2,
  "react-mounted": 3,
};

declare global {
  interface Window {
    __oleaflySplashStage?: (index: number) => void;
    __oleaflySplashTimer?: ReturnType<typeof setInterval>;
  }
}

export function markBootStage(stage: BootStage): void {
  if (reported.has(stage)) return;
  reported.add(stage);
  try {
    performance.mark(`${PREFIX}${stage}`);
  } catch {
    /* performance API unavailable: telemetry is best-effort */
  }
  const splashIndex = SPLASH_STAGE_INDEX[stage];
  if (splashIndex !== undefined && !splashHeld) {
    window.__oleaflySplashStage?.(splashIndex);
  }
  if (stage === "projects-loaded") {
    reportBootMeasures();
  }
}

export function bootStageReached(stage: BootStage): boolean {
  return reported.has(stage);
}

function measureBetween(
  from: BootStage,
  to: BootStage,
): number | null {
  try {
    const measure = performance.measure(
      `${PREFIX}${from}->${to}`,
      `${PREFIX}${from}`,
      `${PREFIX}${to}`,
    );
    return Math.round(measure.duration);
  } catch {
    return null;
  }
}

function reportBootMeasures(): void {
  const evaluateToMount = measureBetween("entry-evaluated", "react-mounted");
  const mountToProjects = measureBetween("react-mounted", "projects-loaded");
  const payload = {
    boot: {
      // navigationStart → entry evaluation covers HTML + chunk fetch/parse.
      htmlToEntryMs: Math.round(performance.now()) - totalAfterEntryMs(),
      entryToMountMs: evaluateToMount,
      mountToProjectsMs: mountToProjects,
      totalMs: Math.round(performance.now()),
    },
  };
  if (import.meta.env.DEV) {
    void appendAppLog(`boot-telemetry ${JSON.stringify(payload.boot)}`).catch(
      () => {},
    );
  }
}

function totalAfterEntryMs(): number {
  try {
    const entries = performance.getEntriesByName(`${PREFIX}entry-evaluated`);
    const first = entries[0];
    return first ? Math.round(performance.now() - first.startTime) : 0;
  } catch {
    return 0;
  }
}

/** Remove the inline HTML splash once React owns the screen. Idempotent. */
export function dismissBootSplash(): void {
  if (window.__oleaflySplashTimer !== undefined) {
    clearInterval(window.__oleaflySplashTimer);
    window.__oleaflySplashTimer = undefined;
  }
  document.getElementById("oleafly-splash")?.remove();
}

export function holdBootSplash(message: string): void {
  const splash = document.getElementById("oleafly-splash");
  if (!splash) return;
  if (window.__oleaflySplashTimer !== undefined) {
    clearInterval(window.__oleaflySplashTimer);
    window.__oleaflySplashTimer = undefined;
  }
  const stage = document.getElementById("oleafly-splash-stage");
  if (stage) stage.textContent = message;
  splash.setAttribute("aria-label", message);
  splashHeld = true;
  clearTimeout(splashHoldTimer);
  splashHoldTimer = setTimeout(releaseBootSplash, SPLASH_HOLD_LIMIT_MS);
}

export function bootSplashHeld(): boolean {
  return splashHeld;
}

export function releaseBootSplash(): void {
  if (!splashHeld) return;
  splashHeld = false;
  clearTimeout(splashHoldTimer);
  splashHoldTimer = undefined;
  dismissBootSplash();
}
