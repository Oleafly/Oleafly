// A single monotonic sequence shared by the two tab sources (open files in the
// files store, git diffs in the diff store) so the editor can render them as one
// list in the order they were opened, rather than files-then-diffs.
let seq = 0;

/** Next open-order stamp for a newly opened editor tab (file or diff). */
export function nextTabSeq(): number {
  return ++seq;
}
