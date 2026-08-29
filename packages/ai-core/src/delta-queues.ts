// The streaming flush scheduler: two queues with different cadences —
// frame-text deltas (agent messages, plans, reasoning) flush on
// requestAnimationFrame while visible, else a timer; bulky output deltas
// (command output) flush on a fixed 50 ms interval. Terminal events
// (item/turn completion) drain both queues before applying — ordering is
// guaranteed by re-entry, not by locking. Framework-free: the host injects
// scheduling primitives so tests can drive time deterministically.

export interface FlushScheduler {
  /** Schedule a frame-cadence flush (rAF in a window, setTimeout fallback). */
  scheduleFrame(flush: () => void): () => void;
  /** Schedule the fixed-interval output flush; returns a canceler. */
  scheduleInterval(flush: () => void, intervalMs: number): () => void;
  /** Is the surface visible? Hidden surfaces fall back to timer flushes. */
  isVisible(): boolean;
}

export const OUTPUT_FLUSH_INTERVAL_MS = 50;
/** Bounded batch so one flush never janks the frame. */
const MAX_BATCH = 512;

type QueueKind = "frameText" | "output";

interface QueuedDelta {
  kind: QueueKind;
  apply: () => void;
}

export type DrainResult = "flushed" | "empty";

/**
 * Two delta queues with drain-before-terminal semantics. The host enqueues
 * appends as closures; `flushNow` runs them in FIFO order (per queue: text
 * ordering and output ordering are each preserved; the queues flush
 * independently, matching their cadences).
 */
export class DeltaQueues {
  private readonly frameText: QueuedDelta[] = [];
  private readonly output: QueuedDelta[] = [];
  private frameHandle: ReturnType<FlushScheduler["scheduleFrame"]> | null = null;
  private intervalHandle: ReturnType<FlushScheduler["scheduleInterval"]> | null = null;

  constructor(private readonly scheduler: FlushScheduler) {}

  /** Enqueue a text-tier append (agent message/plan/reasoning deltas). */
  enqueueFrameText(apply: () => void): void {
    this.frameText.push({ kind: "frameText", apply });
    this.scheduleFrameFlush();
  }

  /** Enqueue an output-tier append (command output deltas). */
  enqueueOutput(apply: () => void): void {
    this.output.push({ kind: "output", apply });
    if (this.intervalHandle === null) {
      const cancel = this.scheduler.scheduleInterval(
        () => this.flushOutput(),
        OUTPUT_FLUSH_INTERVAL_MS,
      );
      this.intervalHandle = cancel;
    }
  }

  private scheduleFrameFlush(): void {
    if (this.frameHandle !== null) {
      return;
    }
    const cancel = this.scheduler.scheduleFrame(() => {
      this.frameHandle = null;
      this.flushFrameText();
    });
    this.frameHandle = cancel;
  }

  flushFrameText(): DrainResult {
    return this.drain(this.frameText);
  }

  flushOutput(): DrainResult {
    const result = this.drain(this.output);
    if (this.intervalHandle !== null && this.output.length === 0) {
      this.intervalHandle();
      this.intervalHandle = null;
    }
    return result;
  }

  private drain(queue: QueuedDelta[]): DrainResult {
    if (queue.length === 0) {
      return "empty";
    }
    const batch = queue.splice(0, MAX_BATCH);
    for (const delta of batch) {
      delta.apply();
    }
    // A batch cap means leftovers must reschedule on their queue's cadence.
    if (queue.length > 0 && queue === this.frameText) {
      this.scheduleFrameFlush();
    }
    return "flushed";
  }

  /**
   * Drain-before-terminal: run `apply` only after every pending delta has
   * landed. If a flush is still pending the terminal event is deferred —
   * returned as a closure the host re-runs after the flush completes.
   */
  drainBeforeTerminal(apply: () => void): (() => void) | null {
    const pending =
      this.frameText.length > 0 ||
      this.output.length > 0 ||
      this.frameHandle !== null ||
      this.intervalHandle !== null;
    if (!pending) {
      apply();
      return null;
    }
    this.flushFrameText();
    this.flushOutput();
    // Anything still queued (over the batch cap) or scheduled-but-not-run
    // defers the terminal event.
    if (this.frameText.length > 0 || this.output.length > 0) {
      return apply;
    }
    apply();
    return null;
  }

  pendingFrameText(): number {
    return this.frameText.length;
  }

  pendingOutput(): number {
    return this.output.length;
  }

  /** Cancel all scheduled flushes (turn ended, surface unmounted). */
  dispose(): void {
    this.frameHandle?.();
    this.frameHandle = null;
    this.intervalHandle?.();
    this.intervalHandle = null;
    this.frameText.length = 0;
    this.output.length = 0;
  }
}

/** A scheduler for tests: everything is manual, nothing runs by itself. */
export class ManualScheduler implements FlushScheduler {
  visible = true;
  private frameCallbacks: Array<() => void> = [];
  private intervalCallbacks: Array<() => void> = [];

  scheduleFrame(flush: () => void): () => void {
    this.frameCallbacks.push(flush);
    return () => {
      this.frameCallbacks = this.frameCallbacks.filter((cb) => cb !== flush);
    };
  }

  scheduleInterval(flush: () => void, _intervalMs: number): () => void {
    void _intervalMs;
    this.intervalCallbacks.push(flush);
    return () => {
      this.intervalCallbacks = this.intervalCallbacks.filter((cb) => cb !== flush);
    };
  }

  isVisible(): boolean {
    return this.visible;
  }

  runFrame(): void {
    const callbacks = this.frameCallbacks;
    this.frameCallbacks = [];
    for (const callback of callbacks) {
      callback();
    }
  }

  runInterval(): void {
    for (const callback of [...this.intervalCallbacks]) {
      callback();
    }
  }
}
