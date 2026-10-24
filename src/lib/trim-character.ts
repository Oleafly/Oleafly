/**
 * `value` without the runs of `character` at both ends. A loop rather than
 * `/x+$/`, which backtracks quadratically on a long run of `x` that is
 * followed by something else.
 */
export function trimCharacter(value: string, character: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === character) start += 1;
  while (end > start && value[end - 1] === character) end -= 1;
  return value.slice(start, end);
}

/** `value` without the run of `character` at its end. */
export function trimTrailingCharacter(value: string, character: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === character) end -= 1;
  return value.slice(0, end);
}
