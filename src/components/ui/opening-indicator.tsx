import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";

export const OPENING_DELAY_MS = 150;

export function OpeningIndicator() {
  const { t } = useTranslation(["common"]);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), OPENING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center">
      <div
        role="status"
        aria-label={t(($) => $.common.state.loading)}
        className="rounded-md border bg-popover p-2 text-muted-foreground shadow-md"
      >
        <Spinner size="lg" aria-hidden />
      </div>
    </div>
  );
}
