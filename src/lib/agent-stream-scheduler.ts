// Window-backed scheduling for the delta queues: text flushes ride
// requestAnimationFrame while the surface is visible (a timer when hidden),
// output flushes ride a 50 ms interval.

import type { FlushScheduler } from "@oleafly/ai-core";

export function windowFlushScheduler(): FlushScheduler {
  return {
    scheduleFrame(flush) {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        const handle = requestAnimationFrame(flush);
        return () => cancelAnimationFrame(handle);
      }
      const handle = setTimeout(flush, 16);
      return () => clearTimeout(handle);
    },
    scheduleInterval(flush, intervalMs) {
      const handle = setInterval(flush, intervalMs);
      return () => clearInterval(handle);
    },
    isVisible() {
      return typeof document === "undefined" || document.visibilityState === "visible";
    },
  };
}
