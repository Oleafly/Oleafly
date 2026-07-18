const keys = new WeakMap<object, number>();
let nextKey = 0;

export function objectKey(value: object, prefix: string): string {
  const existing = keys.get(value);
  if (existing !== undefined) return `${prefix}-${existing}`;
  const key = nextKey++;
  keys.set(value, key);
  return `${prefix}-${key}`;
}
