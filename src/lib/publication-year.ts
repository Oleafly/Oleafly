export const MIN_PUBLICATION_YEAR = 1800;
export const ANY_PUBLICATION_YEAR = "any";

export function publicationYearOptions(
  currentYear = new Date().getFullYear(),
): string[] {
  const safeCurrentYear = Number.isInteger(currentYear)
    ? Math.max(currentYear, MIN_PUBLICATION_YEAR)
    : MIN_PUBLICATION_YEAR;
  return Array.from(
    { length: safeCurrentYear - MIN_PUBLICATION_YEAR + 1 },
    (_, index) => String(safeCurrentYear - index),
  );
}

export function normalizePublicationYearSelection(
  value: string,
  currentYear = new Date().getFullYear(),
): string {
  const normalized = value.trim();
  if (
    !/^\d{4}$/.test(normalized) ||
    Number(normalized) < MIN_PUBLICATION_YEAR ||
    Number(normalized) > currentYear
  ) {
    return ANY_PUBLICATION_YEAR;
  }
  return normalized;
}

export function publicationYearRange(
  fromValue: string,
  toValue: string,
  currentYear = new Date().getFullYear(),
): {
  from: number | null;
  to: number | null;
  normalizedFrom: string;
  normalizedTo: string;
  error: string | null;
} {
  const normalizedFrom = normalizePublicationYearSelection(
    fromValue,
    currentYear,
  );
  const normalizedTo = normalizePublicationYearSelection(
    toValue,
    currentYear,
  );
  const from =
    normalizedFrom === ANY_PUBLICATION_YEAR
      ? null
      : Number(normalizedFrom);
  const to =
    normalizedTo === ANY_PUBLICATION_YEAR ? null : Number(normalizedTo);
  return {
    from,
    to,
    normalizedFrom,
    normalizedTo,
    error:
      from != null && to != null && from > to
        ? "The start year cannot be later than the end year."
        : null,
  };
}
