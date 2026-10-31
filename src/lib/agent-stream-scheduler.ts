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
