import { formatNumber } from "@/lib/intl";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `${formatNumber(0)} ${BYTE_UNITS[0]}`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** unit;
  const formatted = formatNumber(value, {
    maximumFractionDigits: unit === 0 ? 0 : value >= 10 ? 1 : 2,
  });
  return `${formatted} ${BYTE_UNITS[unit]}`;
}
