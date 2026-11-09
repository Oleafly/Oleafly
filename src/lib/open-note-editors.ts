import type { SaveFailure } from "@/store/save-flush-error";

export const NOTE_FLUSH_MS = 4_000;

export interface NoteSaveJob {
  title: () => string;
  timedOut: () => string;
}

export interface NoteFlusher extends NoteSaveJob {
  flush: () => Promise<string | null>;
}

const open = new Map<string, number>();
const flushers = new Set<NoteFlusher>();
const running = new Set<{ job: NoteSaveJob; done: Promise<string | null> }>();

export function noteEditorOpened(id: string): () => void {
  open.set(id, (open.get(id) ?? 0) + 1);
  return () => {
    const left = (open.get(id) ?? 1) - 1;
    if (left > 0) open.set(id, left);
    else open.delete(id);
  };
}

export function noteEditorOpen(id: string): boolean {
  return open.has(id);
}

export function registerNoteFlush(flusher: NoteFlusher): () => void {
  flushers.add(flusher);
  return () => {
    flushers.delete(flusher);
  };
}

export function trackNoteSave(job: NoteSaveJob, done: Promise<string | null>): void {
  const entry = { job, done };
  running.add(entry);
  void done.then(
    () => running.delete(entry),
    () => running.delete(entry),
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function within(done: Promise<string | null>, waitMs: number, timedOut: () => string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(timedOut()), waitMs);
  });
  try {
    return await Promise.race([done.catch(reasonOf), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function flushOpenNotes(waitMs: number = NOTE_FLUSH_MS): Promise<SaveFailure[]> {
  const jobs = [
    ...[...flushers].map((flusher) => ({ job: flusher, done: Promise.resolve().then(flusher.flush) })),
    ...running,
  ];
  const reasons = await Promise.all(jobs.map(({ job, done }) => within(done, waitMs, job.timedOut)));
  return jobs.flatMap(({ job }, index) => {
    const reason = reasons[index];
    return reason === null ? [] : [{ path: job.title(), reason }];
  });
}
