import { i18n } from "@/i18n";
import { formatDate, formatDateTime } from "@/lib/intl";
export function projectModifiedLabel(timestamp: number) {
  if (!timestamp) return undefined;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86_400_000,
  );
  if (days === 0) return i18n.t(($) => $.core.project.updatedToday);
  if (days === 1) return i18n.t(($) => $.core.project.updatedYesterday);
  if (days > 1 && days < 7) {
    return i18n.t(($) => $.core.project.updatedDaysAgo, { count: days });
  }
  return i18n.t(($) => $.core.project.updatedOn, {
    date: formatDate(
      date,
      new Date().getFullYear() === date.getFullYear()
        ? { month: "short", day: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" },
    ),
  });
}

export function projectDateTime(timestamp: number) {
  if (!timestamp) return i18n.t(($) => $.core.project.dateUnavailable);
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return i18n.t(($) => $.core.project.dateUnavailable);
  return formatDateTime(date, { dateStyle: "medium", timeStyle: "short" });
}
