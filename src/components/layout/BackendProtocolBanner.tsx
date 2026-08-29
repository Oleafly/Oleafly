import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { BACKEND_CAPABILITIES, PROTOCOL_VERSION } from "@oleafly/backend-port";
import { backendProtocolInfo } from "@/lib/tauri";

// Degradation notice for a shell/backend contract mismatch (see
// packages/backend-port PROTOCOL_VERSION). Stays hidden when the backend is
// unreachable: that is a startup-ordering or dev-harness situation, not drift.
export function BackendProtocolBanner() {
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void backendProtocolInfo()
      .then((info) => {
        if (cancelled) return;
        const missing = BACKEND_CAPABILITIES.some(
          (capability) => !info.capabilities.includes(capability),
        );
        setMismatch(info.protocol_version !== PROTOCOL_VERSION || missing);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mismatch) return null;

  return (
    <div
      role="alert"
      data-testid="backend-protocol-banner"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      <span>
        This window and its backend were built for different Oleafly versions,
        so some features may not work. Reinstalling the app fixes this.
      </span>
    </div>
  );
}
