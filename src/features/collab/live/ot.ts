import type { Utf16Edit } from "@oleafly/editor/document-session";
import type { CollabTextOperation } from "@/lib/tauri";

export type OtErrorCode = "length_mismatch" | "incompatible" | "splits_character" | "invalid";

const MESSAGES: Record<OtErrorCode, string> = {
  length_mismatch: "The change does not fit the document.",
  incompatible: "The changes do not line up.",
  splits_character: "The change splits a character in two.",
  invalid: "The change is not a valid operation.",
};

export class OtError extends Error {
  readonly code: OtErrorCode;

  constructor(code: OtErrorCode) {
    super(MESSAGES[code]);
    this.name = "OtError";
    this.code = code;
  }
}

type Step = number | string;

const isRetain = (step: Step | undefined): step is number => typeof step === "number" && step > 0;
const isDelete = (step: Step | undefined): step is number => typeof step === "number" && step < 0;
const isInsert = (step: Step | undefined): step is string => typeof step === "string";

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number | undefined): boolean {
  return code !== undefined && code >= 0xdc00 && code <= 0xdfff;
}

export function splitsSurrogatePair(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  const point = text.codePointAt(at - 1);
  return point !== undefined && point > 0xffff;
}

function splitAt(text: string, at: number): [string, string] {
  if (splitsSurrogatePair(text, at)) throw new OtError("splits_character");
  return [text.slice(0, at), text.slice(at)];
}

function checkCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) throw new OtError("invalid");
}

function stepLength(step: Step): number {
  return typeof step === "string" ? step.length : Math.abs(step);
}

function remainder(step: Step, count: number): Step | null {
  if (typeof step === "string") return step.length > count ? splitAt(step, count)[1] : null;
  if (step > 0) return step > count ? step - count : null;
  return -step > count ? step + count : null;
}

class StepReader {
  current: Step | undefined;
  private index = 1;

  constructor(private readonly steps: readonly Step[]) {
    this.current = steps[0];
  }

  advance(): void {
    this.current = this.steps[this.index++];
  }

  resume(rest: Step | null): void {
    if (rest === null) this.advance();
    else this.current = rest;
  }
}

function composeStep(result: TextOperation, left: StepReader, right: StepReader): void {
  const a = left.current;
  const b = right.current;
  if (isDelete(a)) {
    result.delete(-a);
    left.advance();
    return;
  }
  if (isInsert(b)) {
    result.insert(b);
    right.advance();
    return;
  }
  if (a === undefined || b === undefined) throw new OtError("incompatible");
  const step = Math.min(stepLength(a), stepLength(b));
  if (isRetain(a) && isRetain(b)) result.retain(step);
  else if (isInsert(a) && isRetain(b)) result.insert(a.slice(0, step));
  else if (isRetain(a) && isDelete(b)) result.delete(step);
  left.resume(remainder(a, step));
  right.resume(remainder(b, step));
}

function transformStep(
  clientPrime: TextOperation,
  serverPrime: TextOperation,
  left: StepReader,
  right: StepReader,
): void {
  const a = left.current;
  const b = right.current;
  if (isInsert(a)) {
    serverPrime.retain(a.length);
    clientPrime.insert(a);
    left.advance();
    return;
  }
  if (isInsert(b)) {
    clientPrime.retain(b.length);
    serverPrime.insert(b);
    right.advance();
    return;
  }
  if (a === undefined || b === undefined) throw new OtError("incompatible");
  const step = Math.min(stepLength(a), stepLength(b));
  if (isRetain(a) && isRetain(b)) {
    clientPrime.retain(step);
    serverPrime.retain(step);
  } else if (isDelete(a) && isRetain(b)) {
    clientPrime.delete(step);
  } else if (isRetain(a) && isDelete(b)) {
    serverPrime.delete(step);
  }
  left.resume(remainder(a, step));
  right.resume(remainder(b, step));
}

export class TextOperation {
  private readonly steps: Step[] = [];
  baseLength = 0;
  targetLength = 0;

  retain(count: number): this {
    checkCount(count);
    if (count === 0) return this;
    this.baseLength += count;
    this.targetLength += count;
    const last = this.steps.at(-1);
    if (isRetain(last)) this.steps[this.steps.length - 1] = last + count;
    else this.steps.push(count);
    return this;
  }

  insert(text: string): this {
    if (text === "") return this;
    this.targetLength += text.length;
    const steps = this.steps;
    const last = steps.at(-1);
    if (isInsert(last)) {
      steps[steps.length - 1] = last + text;
    } else if (isDelete(last)) {
      const previous = steps.at(-2);
      if (isInsert(previous)) steps[steps.length - 2] = previous + text;
      else steps.splice(-1, 0, text);
    } else {
      steps.push(text);
    }
    return this;
  }

  delete(count: number): this {
    checkCount(count);
    if (count === 0) return this;
    this.baseLength += count;
    const last = this.steps.at(-1);
    if (isDelete(last)) this.steps[this.steps.length - 1] = last - count;
    else this.steps.push(-count);
    return this;
  }

  isNoop(): boolean {
    return this.steps.every(isRetain);
  }

  get size(): number {
    return this.steps.length;
  }

  equals(other: TextOperation): boolean {
    return (
      this.baseLength === other.baseLength &&
      this.targetLength === other.targetLength &&
      this.steps.length === other.steps.length &&
      this.steps.every((step, index) => step === other.steps[index])
    );
  }

  toWire(): CollabTextOperation {
    return [...this.steps];
  }

  static fromWire(wire: readonly unknown[]): TextOperation {
    const operation = new TextOperation();
    for (const step of wire) {
      if (typeof step === "string") {
        if (step === "") throw new OtError("invalid");
        operation.insert(step);
      } else if (typeof step === "number" && Number.isSafeInteger(step) && step !== 0) {
        if (step > 0) operation.retain(step);
        else operation.delete(-step);
      } else {
        throw new OtError("invalid");
      }
    }
    return operation;
  }

  apply(text: string): string {
    if (text.length !== this.baseLength) throw new OtError("length_mismatch");
    let output = "";
    let position = 0;
    for (const step of this.steps) {
      if (isInsert(step)) {
        output += step;
        continue;
      }
      const end = position + Math.abs(step);
      if (splitsSurrogatePair(text, end)) throw new OtError("splits_character");
      if (isRetain(step)) output += text.slice(position, end);
      position = end;
    }
    return output + text.slice(position);
  }

  compose(other: TextOperation): TextOperation {
    if (this.targetLength !== other.baseLength) throw new OtError("length_mismatch");
    const result = new TextOperation();
    const left = new StepReader(this.steps);
    const right = new StepReader(other.steps);
    while (left.current !== undefined || right.current !== undefined) composeStep(result, left, right);
    return result;
  }

  static transform(client: TextOperation, server: TextOperation): [TextOperation, TextOperation] {
    if (client.baseLength !== server.baseLength) throw new OtError("length_mismatch");
    const clientPrime = new TextOperation();
    const serverPrime = new TextOperation();
    const left = new StepReader(client.steps);
    const right = new StepReader(server.steps);
    while (left.current !== undefined || right.current !== undefined) {
      transformStep(clientPrime, serverPrime, left, right);
    }
    return [clientPrime, serverPrime];
  }

  forEachStep(visit: (step: Step) => void): void {
    for (const step of this.steps) visit(step);
  }
}

export function operationFromEdits(text: string, edits: readonly Utf16Edit[]): TextOperation {
  const operation = new TextOperation();
  let position = 0;
  for (const edit of edits) {
    if (!Number.isSafeInteger(edit.from) || !Number.isSafeInteger(edit.to)) {
      throw new RangeError("Edit offsets must be whole numbers.");
    }
    if (edit.from < position || edit.to < edit.from || edit.to > text.length) {
      throw new RangeError("Edits must be in order and inside the text.");
    }
    if (splitsSurrogatePair(text, edit.from) || splitsSurrogatePair(text, edit.to)) {
      throw new RangeError("Edits must not split a surrogate pair.");
    }
    if (edit.insert.includes("\r")) throw new RangeError("Edits must use LF line breaks.");
    operation.retain(edit.from - position).insert(edit.insert).delete(edit.to - edit.from);
    position = edit.to;
  }
  return operation.retain(text.length - position);
}

export function editsFromOperation(operation: TextOperation): Utf16Edit[] {
  const edits: Utf16Edit[] = [];
  let position = 0;
  operation.forEachStep((step) => {
    if (isInsert(step)) {
      edits.push({ from: position, to: position, insert: step });
    } else if (isRetain(step)) {
      position += step;
    } else {
      const last = edits.at(-1);
      if (last?.to === position) last.to = position - step;
      else edits.push({ from: position, to: position - step, insert: "" });
      position -= step;
    }
  });
  return edits;
}

export function replacementOperation(before: string, after: string): TextOperation {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLowSurrogate(before.codePointAt(before.length - suffix))) suffix -= 1;
  return new TextOperation()
    .retain(prefix)
    .insert(after.slice(prefix, after.length - suffix))
    .delete(before.length - suffix - prefix)
    .retain(suffix);
}

const MAX_LINE_EDITS = 400;

type LineStep = "equal" | "delete" | "insert";

function linesOf(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf("\n", start);
    if (end < 0) {
      lines.push(text.slice(start));
      break;
    }
    lines.push(text.slice(start, end + 1));
    start = end + 1;
  }
  return lines;
}

function walkBack(trace: readonly Int32Array[], n: number, m: number, offset: number, last: number): LineStep[] {
  const steps: LineStep[] = [];
  let x = n;
  let y = m;
  for (let d = last; d > 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
    const previousK = down ? k + 1 : k - 1;
    const previousX = v[offset + previousK];
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      steps.push("equal");
      x -= 1;
      y -= 1;
    }
    steps.push(down ? "insert" : "delete");
    if (down) y -= 1;
    else x -= 1;
  }
  while (x > 0 && y > 0) {
    steps.push("equal");
    x -= 1;
    y -= 1;
  }
  return steps.reverse();
}

function lineScript(a: readonly string[], b: readonly string[], limit: number): LineStep[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, limit);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return walkBack(trace, n, m, offset, d);
    }
  }
  return null;
}

function appendReplacement(operation: TextOperation, removed: string, added: string): void {
  replacementOperation(removed, added).forEachStep((step) => {
    if (typeof step === "string") operation.insert(step);
    else if (step > 0) operation.retain(step);
    else operation.delete(-step);
  });
}

export function diffOperation(before: string, after: string): TextOperation {
  if (before === after) return new TextOperation().retain(before.length);
  const a = linesOf(before);
  const b = linesOf(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail += 1;
  }
  const script = lineScript(a.slice(head, a.length - tail), b.slice(head, b.length - tail), MAX_LINE_EDITS);
  if (script === null) return replacementOperation(before, after);
  const operation = new TextOperation();
  let kept = 0;
  for (let index = 0; index < head; index += 1) kept += a[index].length;
  operation.retain(kept);
  let i = head;
  let j = head;
  let step = 0;
  while (step < script.length) {
    if (script[step] === "equal") {
      operation.retain(a[i].length);
      i += 1;
      j += 1;
      step += 1;
      continue;
    }
    let removed = "";
    let added = "";
    while (step < script.length && script[step] !== "equal") {
      if (script[step] === "delete") {
        removed += a[i];
        i += 1;
      } else {
        added += b[j];
        j += 1;
      }
      step += 1;
    }
    appendReplacement(operation, removed, added);
  }
  let rest = 0;
  for (let index = a.length - tail; index < a.length; index += 1) rest += a[index].length;
  return operation.retain(rest);
}
