export function projectModifiedLabel(timestamp: number) {
  if (!timestamp) return undefined;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
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
