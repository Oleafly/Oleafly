import { ChangeSet } from "@codemirror/state";

export interface DocumentSettingsEdit {
  from: number;
  to: number;
  insert: string;
}

export type DocumentSettingState =
  | { status: "unset" }
  | { status: "set"; value: string }
  | { status: "locked"; reason: string; source: string; owner?: string };

export type DocumentSettingChanges<K extends string> = Partial<Record<K, string | null>>;

export type SettingsStep = (current: string) => DocumentSettingsEdit[];

export function applySettingEdits(text: string, edits: readonly DocumentSettingsEdit[]): string {
  let out = text;
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    out = `${out.slice(0, edit.from)}${edit.insert}${out.slice(edit.to)}`;
  }
  return out;
}

export function composeSettingSteps(text: string, steps: readonly SettingsStep[]): DocumentSettingsEdit[] {
  let current = text;
  let composed = ChangeSet.empty(text.length);
  for (const step of steps) {
    const edits = step(current).sort((left, right) => left.from - right.from);
    if (edits.length === 0) continue;
    composed = composed.compose(ChangeSet.of(edits, current.length, "\n"));
    current = applySettingEdits(current, edits);
  }
  const out: DocumentSettingsEdit[] = [];
  composed.iterChanges((from, to, _fromB, _toB, inserted) => {
    out.push({ from, to, insert: inserted.toString() });
  });
  return out;
}

export function lastWhere<T>(items: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    if (test(items[index])) return items[index];
  }
  return undefined;
}

export function lineStartOf(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

export function lineEndOf(text: string, pos: number): number {
  const end = text.indexOf("\n", pos);
  return end < 0 ? text.length : end;
}

export function removeRange(text: string, from: number, to: number): DocumentSettingsEdit {
  const start = lineStartOf(text, from);
  const end = lineEndOf(text, to);
  const alone = text.slice(start, from).trim() === "" && text.slice(to, end).trim() === "";
  if (alone) return { from: start, to: Math.min(text.length, end + 1), insert: "" };
  let stop = to;
  while (text[stop] === " " || text[stop] === "\t") stop += 1;
  return { from, to: stop, insert: "" };
}
