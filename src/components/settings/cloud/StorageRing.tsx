import { useTranslation } from "react-i18next";
import type { CloudSpace } from "@/lib/cloud";
import { formatBytes } from "@/lib/format-bytes";
import { formatNumber } from "@/lib/intl";

export type StorageTone = "roomy" | "filling" | "tight" | "full";

const TONE_CLASS: Readonly<Record<StorageTone, string>> = {
  roomy: "text-emerald-500 dark:text-emerald-400",
  filling: "text-yellow-500 dark:text-yellow-400",
  tight: "text-orange-500 dark:text-orange-400",
  full: "text-red-500 dark:text-red-400",
};

const RADIUS = 15.9155;

export function storageTone(percent: number): StorageTone {
  if (percent >= 80) return "full";
  if (percent >= 65) return "tight";
  if (percent >= 50) return "filling";
  return "roomy";
}

export function StorageRing({ space }: Readonly<{ space: CloudSpace | null }>) {
  const { t } = useTranslation(["cloud"]);
  if (!space || !Number.isFinite(space.allocated) || space.allocated <= 0 || !Number.isFinite(space.used)) {
    return null;
  }
  const used = Math.max(0, space.used);
  const percent = Math.min(100, (used / space.allocated) * 100);
  const shown = used > 0 && percent < 1 ? 1 : Math.round(percent);
  const tone = storageTone(percent);
  const usedText = t(($) => $.cloud.storage.used, {
    used: formatBytes(used),
    total: formatBytes(space.allocated),
  });
  const freeText = t(($) => $.cloud.storage.free, {
    free: formatBytes(Math.max(0, space.allocated - used)),
  });
  return (
    <div data-testid="cloud-storage" data-tone={tone} className="flex shrink-0 items-center gap-3">
      <span className="relative inline-flex size-14 shrink-0">
        <progress
          className="sr-only"
          aria-label={t(($) => $.cloud.storage.label)}
          aria-valuetext={usedText}
          max={100}
          value={shown}
        />
        <svg viewBox="0 0 36 36" aria-hidden className="size-full">
          <circle cx="18" cy="18" r={RADIUS} fill="none" strokeWidth="3.5" className="stroke-foreground/10" />
          {percent > 0 ? (
            <circle
              cx="18"
              cy="18"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${percent} 100`}
              transform="rotate(-90 18 18)"
              className={TONE_CLASS[tone]}
            />
          ) : null}
        </svg>
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-foreground"
        >
          {formatNumber(shown / 100, { style: "percent", maximumFractionDigits: 0 })}
        </span>
      </span>
      <span className="min-w-0 text-xs leading-relaxed">
        <span className="block font-medium text-foreground">{usedText}</span>
        <span className="block text-muted-foreground">{freeText}</span>
      </span>
    </div>
  );
}
