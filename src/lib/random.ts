const EXPONENT_OF_ONE = 1023n << 52n;

export function randomFraction(): number {
  const [bits] = crypto.getRandomValues(new BigUint64Array(1));
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, (bits >> 12n) | EXPONENT_OF_ONE);
  return view.getFloat64(0) - 1;
}
