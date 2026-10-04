import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { BACKEND_CAPABILITIES, PROTOCOL_VERSION } from "@oleafly/backend-port";
import { backendProtocolInfo } from "@/lib/tauri";
import { WorkspaceBanner } from "@/components/ui/workspace-banner";

// Degradation notice for a shell/backend contract mismatch (see
// packages/backend-port PROTOCOL_VERSION). Stays hidden when the backend is
// unreachable: that is a startup-ordering or dev-harness situation, not drift.
export function BackendProtocolBanner() {
  const { t } = useTranslation(["shell"]);
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
    <WorkspaceBanner
      tone="warning"
      role="alert"
      data-testid="backend-protocol-banner"
      className="justify-center"
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      <span>{t(($) => $.shell.backendProtocol.mismatch)}</span>
    </WorkspaceBanner>
  );
}
