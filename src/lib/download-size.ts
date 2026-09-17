import { i18n } from "@/i18n";
import { formatNumber } from "@/lib/intl";

export function formatDownloadSize(bytes: number): string {
  if (!bytes) return "";
  const megabytes = bytes / 1_000_000;
  if (megabytes >= 1) {
    const digits = megabytes >= 10 ? 0 : 1;
    return i18n.t(($) => $.settings.downloads.size.megabytes, {
      value: formatNumber(megabytes, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }),
    });
  }
  return i18n.t(($) => $.settings.downloads.size.kilobytes, {
    value: formatNumber(Math.max(1, Math.round(bytes / 1000))),
  });
}
