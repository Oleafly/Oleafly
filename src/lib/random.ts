export function randomFraction(): number {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return value / 0xffff_ffff;
}
