export type PdfRenderKind = "base" | "detail";

export type PdfContinue = (cont: () => void) => void;

export interface PdfSchedulableTask {
  onContinue: unknown;
  promise: Promise<unknown>;
}

export type PdfRenderPriority = (pageNumber: number, kind: PdfRenderKind) => number;

export interface PdfRenderScheduler {
  add(task: PdfSchedulableTask, pageNumber: number, kind: PdfRenderKind): void;
  waiting(): number;
  destroy(): void;
}

interface WaitingRender {
  pageNumber: number;
  kind: PdfRenderKind;
  resume: () => void;
}

export function createPdfRenderScheduler(priority: PdfRenderPriority): PdfRenderScheduler {
  const waiting = new Map<PdfSchedulableTask, WaitingRender>();
  let grantedThisFrame = false;
  let frame = 0;
  let destroyed = false;

  const best = (): [PdfSchedulableTask, WaitingRender] | null => {
    let chosen: [PdfSchedulableTask, WaitingRender] | null = null;
    let chosenPriority = Number.POSITIVE_INFINITY;
    for (const entry of waiting) {
      const value = priority(entry[1].pageNumber, entry[1].kind);
      if (chosen === null || value < chosenPriority) {
        chosen = entry;
        chosenPriority = value;
      }
    }
    return chosen;
  };

  const scheduleFrame = () => {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      grantedThisFrame = false;
      const next = best();
      if (!next) return;
      waiting.delete(next[0]);
      grantedThisFrame = true;
      next[1].resume();
      scheduleFrame();
    });
  };

  return {
    add(task, pageNumber, kind) {
      const onContinue: PdfContinue = (resume) => {
        if (destroyed) {
          resume();
          return;
        }
        if (!grantedThisFrame) {
          grantedThisFrame = true;
          resume();
          scheduleFrame();
          return;
        }
        waiting.set(task, { pageNumber, kind, resume });
        scheduleFrame();
      };
      task.onContinue = onContinue;
      const settle = () => {
        waiting.delete(task);
      };
      task.promise.then(settle, settle);
    },
    waiting() {
      return waiting.size;
    },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const released = [...waiting.values()];
      waiting.clear();
      for (const entry of released) entry.resume();
    },
  };
}
