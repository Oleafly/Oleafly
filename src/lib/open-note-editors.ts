import type { Editor } from "@tiptap/core";
import type { SaveFailure } from "@/store/save-flush-error";

export const NOTE_FLUSH_MS = 4_000;

export interface NoteSaveJob {
  title: () => string;
  timedOut: () => string;
}

export type NoteHistoryCommand = (redo: boolean) => void;

export interface OpenNoteEditor extends NoteSaveJob {
  editor: Editor;
  root: HTMLElement | null;
  text: () => string;
  flush: () => Promise<string | null>;
  busy: () => boolean;
  history: NoteHistoryCommand;
}

interface TrackedSave {
  job: NoteSaveJob;
  done: Promise<string | null>;
  failed: string | null;
  retry: (() => Promise<string | null>) | null;
}

const editors = new Map<string, readonly OpenNoteEditor[]>();
const waiters = new Set<() => void>();
const running = new Set<TrackedSave>();

export function registerNoteEditor(id: string, handle: OpenNoteEditor): () => void {
  editors.set(id, [...(editors.get(id) ?? []), handle]);
  for (const wake of [...waiters]) wake();
  return () => {
    const left = (editors.get(id) ?? []).filter((entry) => entry !== handle);
    if (left.length > 0) editors.set(id, left);
    else editors.delete(id);
  };
}

export function noteEditorOpen(id: string): boolean {
  return editors.has(id);
}

export function noteEditorBusy(id: string): boolean {
  return (editors.get(id) ?? []).some((entry) => entry.busy());
}

export function openNoteEditor(id: string): OpenNoteEditor | null {
  return editors.get(id)?.at(-1) ?? null;
}

export function openNoteText(id: string): string | null {
  return openNoteEditor(id)?.text() ?? null;
}

export function waitForNoteEditor(id: string, signal: AbortSignal): Promise<OpenNoteEditor | null> {
  const found = openNoteEditor(id);
  if (found || signal.aborted) return Promise.resolve(found);
  return new Promise((resolve) => {
    const finish = () => {
      const handle = openNoteEditor(id);
      if (!handle && !signal.aborted) return;
      waiters.delete(finish);
      signal.removeEventListener("abort", finish);
      resolve(handle);
    };
    waiters.add(finish);
    signal.addEventListener("abort", finish);
  });
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function follow(entry: TrackedSave, done: Promise<string | null>): Promise<string | null> {
  const settled = done.catch(reasonOf);
  entry.done = settled;
  void settled.then((reason) => {
    if (entry.done !== settled) return;
    if (reason === null) running.delete(entry);
    else entry.failed = reason;
  });
  return settled;
}

export function trackNoteSave(
  job: NoteSaveJob,
  done: Promise<string | null>,
  retry: (() => Promise<string | null>) | null = null,
): void {
  const entry: TrackedSave = { job, done, failed: null, retry };
  running.add(entry);
  follow(entry, done);
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

function closedSaveJob(entry: TrackedSave) {
  const retrying = entry.failed !== null && entry.retry !== null;
  entry.failed = null;
  const done = retrying && entry.retry ? follow(entry, Promise.resolve().then(entry.retry)) : entry.done;
  return { job: entry.job, done, entry };
}

export async function flushOpenNotes(waitMs: number = NOTE_FLUSH_MS): Promise<SaveFailure[]> {
  const closed = [...running].map(closedSaveJob);
  const open = [...editors.values()].flat();
  const jobs = [
    ...open.map((handle) => ({ job: handle as NoteSaveJob, done: Promise.resolve().then(handle.flush), entry: null })),
    ...closed,
  ];
  const reasons = await Promise.all(jobs.map(({ job, done }) => within(done, waitMs, job.timedOut)));
  return jobs.flatMap(({ job, entry }, index) => {
    const reason = reasons[index];
    if (reason === null) return [];
    if (entry) running.delete(entry);
    return [{ path: job.title(), reason }];
  });
}

export function noteHistoryAt(element: Element | null): NoteHistoryCommand | null {
  if (!element) return null;
  for (const handles of editors.values()) {
    for (const handle of handles) {
      if (handle.root?.contains(element)) return handle.history;
    }
  }
  return null;
}
