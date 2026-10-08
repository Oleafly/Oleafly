export function collisionSuffix(index: number): string {
  let suffix = "";
  let value = index;
  do {
    suffix = String.fromCodePoint(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return suffix;
}
