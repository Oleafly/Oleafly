export function withOccurrenceKeys<T>(
  items: readonly T[],
  base: (item: T) => string,
): { item: T; key: string }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const name = base(item);
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return { item, key: count === 0 ? name : `${name}#${count}` };
  });
}
