export interface FlushScheduler {
  scheduleFrame(flush: () => void): () => void;
  scheduleInterval(flush: () => void, intervalMs: number): () => void;
  isVisible(): boolean;
}

export const OUTPUT_FLUSH_INTERVAL_MS = 50;
export const MAX_BATCH = 512;

type QueueKind = "frameText" | "output";

interface QueuedDelta {
  kind: QueueKind;
  apply: () => void;
}

export type DrainResult = "flushed" | "empty";

export class DeltaQueues {
  private readonly frameText: QueuedDelta[] = [];
  private readonly output: QueuedDelta[] = [];
  private frameHandle: ReturnType<FlushScheduler["scheduleFrame"]> | null = null;
  private intervalHandle: ReturnType<FlushScheduler["scheduleInterval"]> | null = null;
  private drainingFrame = false;
  private drainingOutput = false;

  constructor(private readonly scheduler: FlushScheduler) {}

  enqueueFrameText(apply: () => void): void {
    this.frameText.push({ kind: "frameText", apply });
    this.scheduleFrameFlush();
  }

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
    if (this.drainingFrame) return "empty";
    this.drainingFrame = true;
    try {
      return this.drain(this.frameText);
    } finally {
      this.drainingFrame = false;
    }
  }

  flushOutput(): DrainResult {
    if (this.drainingOutput) return "empty";
    this.drainingOutput = true;
    try {
      const result = this.drain(this.output);
      if (this.intervalHandle !== null && this.output.length === 0) {
        this.intervalHandle();
        this.intervalHandle = null;
      }
      return result;
    } finally {
      this.drainingOutput = false;
    }
  }

  private drain(queue: QueuedDelta[]): DrainResult {
    if (queue.length === 0) {
      return "empty";
    }
    const batch = queue.splice(0, MAX_BATCH);
    for (const delta of batch) {
      delta.apply();
    }
    if (queue.length > 0 && queue === this.frameText) {
      this.scheduleFrameFlush();
    }
    return "flushed";
  }

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

  dispose(): void {
    this.frameHandle?.();
    this.frameHandle = null;
    this.intervalHandle?.();
    this.intervalHandle = null;
    this.frameText.length = 0;
    this.output.length = 0;
  }
}

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
    for (const callback of this.intervalCallbacks) {
      callback();
    }
  }
}
