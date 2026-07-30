export function projectModifiedLabel(timestamp: number) {
  if (!timestamp) return undefined;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86_400_000,
  );
  if (days === 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days > 1 && days < 7) return `Updated ${days} days ago`;
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: new Date().getFullYear() === date.getFullYear() ? undefined : "numeric",
  }).format(date)}`;
}

export function projectDateTime(timestamp: number) {
  if (!timestamp) return "Unavailable";
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
