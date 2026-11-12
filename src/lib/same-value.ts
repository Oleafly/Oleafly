export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  if (left instanceof Map && right instanceof Map) {
    return left.size === right.size && [...left].every(([key, value]) => right.has(key) && sameValue(value, right.get(key)));
  }
  if (left instanceof Set && right instanceof Set) return left.size === right.size && [...left].every((value) => right.has(value));
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}

export function keepSame<T>(previous: T, next: T): T {
  return sameValue(previous, next) ? previous : next;
}
