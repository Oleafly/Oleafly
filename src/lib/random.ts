export const MAX_UINT32 = 2 ** 32 - 1;

export function randomFraction(): number {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return value / MAX_UINT32;
}
