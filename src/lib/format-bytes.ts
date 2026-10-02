import { i18n } from "@/i18n";
import { formatNumber } from "@/lib/intl";

const BYTE_UNITS = ["bytes", "kilobytes", "megabytes", "gigabytes", "terabytes"] as const;

function withUnit(value: string, unit: number): string {
  return i18n.t(($) => $.common.byteSize[BYTE_UNITS[unit]], { value });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return withUnit(formatNumber(0), 0);
  const unit = Math.max(0, Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1));
  const value = bytes / 1024 ** unit;
  const formatted = formatNumber(value, {
    maximumFractionDigits: unit === 0 ? 0 : value >= 10 ? 1 : 2,
  });
  return withUnit(formatted, unit);
}
