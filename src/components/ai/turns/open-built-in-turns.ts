import { agentTurnFinish } from "@/lib/agent-turns";

/**
 * Built-in assistant turns that were begun and not yet finished, kept in this
 * window's sessionStorage so they outlive a reload. A reload (the in-app
 * Reload buttons call `window.location.reload()`) ends the run before its
 * `finally` can finish the turn, but the backend keeps the turn open for up to
 * a day and marks every later turn in the project as overlapped. The next load
 * of the window closes those turns with an ordinary finish, which the backend
 * treats as idempotent.
 */
const STORAGE_KEY = "oleafly.open-built-in-turns";

interface OpenTurn {
  projectId: string;
  snapshotId: string;
  /** The page load that began the turn. */
  page: string;
}

// Differs between loads of the window (performance.timeOrigin also survives
// hot module reloads), so a run still going in this page is never taken for a
// leftover.
const PAGE = pageIdentity();

function pageIdentity(): string {
  const origin = typeof performance === "undefined" ? undefined : performance.timeOrigin;
  return typeof origin === "number" && Number.isFinite(origin)
    ? `t${origin}`
    : `r${crypto.randomUUID()}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isOpenTurn(value: unknown): value is OpenTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Record<string, unknown>;
  return (
    typeof turn.projectId === "string" &&
    typeof turn.snapshotId === "string" &&
    typeof turn.page === "string"
  );
}

function readTurns(): OpenTurn[] {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isOpenTurn) : [];
  } catch {
    return [];
  }
}

function writeTurns(turns: readonly OpenTurn[]): void {
  try {
    const store = storage();
    if (!store) return;
    if (turns.length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(turns));
  } catch {
    // Without storage a reload leaves the turn open until the app restarts.
  }
}

export function rememberOpenBuiltInTurn(projectId: string, snapshotId: string): void {
  writeTurns([
    ...readTurns().filter((turn) => turn.snapshotId !== snapshotId),
    { projectId, snapshotId, page: PAGE },
  ]);
}

export function forgetOpenBuiltInTurn(snapshotId: string): void {
  const turns = readTurns();
  const kept = turns.filter((turn) => turn.snapshotId !== snapshotId);
  if (kept.length !== turns.length) writeTurns(kept);
}

const closingIds = new Set<string>();
let closing: Promise<void> = Promise.resolve();

/**
 * Finishes the turns an earlier load of this window began and never finished.
 * Resolves once every such turn is closed; it never rejects.
 */
export function closeLeftoverBuiltInTurns(): Promise<void> {
  const leftover = readTurns().filter(
    (turn) => turn.page !== PAGE && !closingIds.has(turn.snapshotId),
  );
  for (const turn of leftover) {
    closingIds.add(turn.snapshotId);
    const close = agentTurnFinish(turn.projectId, turn.snapshotId)
      .catch(() => undefined)
      .then(() => {
        forgetOpenBuiltInTurn(turn.snapshotId);
        closingIds.delete(turn.snapshotId);
      });
    closing = Promise.all([closing, close]).then(() => undefined);
  }
  return closing;
}
