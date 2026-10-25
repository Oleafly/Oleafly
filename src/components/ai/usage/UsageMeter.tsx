import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { LoadingState } from "@/components/ui/empty";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { ContextRing } from "./ContextRing";
import type { UsageSnapshot } from "./types";

const UsagePopover = lazy(() => import("./UsagePopover"));

/** The context ring in the composer row; it opens the usage popover. */
export function UsageMeter({
  snapshot,
  tooltip,
  ariaLabel,
  loadExtras,
  onRefreshPlan,
  refreshing,
  dataTour,
}: Readonly<{
  snapshot: UsageSnapshot;
  tooltip: string;
  ariaLabel?: string;
  loadExtras?: () => Promise<Partial<UsageSnapshot>>;
  onRefreshPlan?: () => void;
  refreshing?: boolean;
  dataTour?: string;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  return (
    <span data-tour={dataTour} className="inline-flex shrink-0">
      <Tooltip label={tooltip}>
        <Popover
          align="right"
          closeOnClick={false}
          ariaLabel={ariaLabel ?? t(($) => $.ai.header.usageAriaLabel)}
          triggerClassName="ai-composer-usage h-7 w-7 shrink-0 justify-center px-0"
          className="w-72 p-0"
          trigger={<ContextRing snapshot={snapshot} />}
        >
          <Suspense fallback={<LoadingState size="compact" label={t(($) => $.ai.usage.loading)} />}>
            <UsagePopover
              snapshot={snapshot}
              loadExtras={loadExtras}
              onRefreshPlan={onRefreshPlan}
              refreshing={refreshing}
            />
          </Suspense>
        </Popover>
      </Tooltip>
    </span>
  );
}
