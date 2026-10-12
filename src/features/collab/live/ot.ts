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

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function splitsSurrogatePair(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  return isHighSurrogate(text.charCodeAt(at - 1)) && isLowSurrogate(text.charCodeAt(at));
}

function splitAt(text: string, at: number): [string, string] {
  if (splitsSurrogatePair(text, at)) throw new OtError("splits_character");
  return [text.slice(0, at), text.slice(at)];
}

function checkCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) throw new OtError("invalid");
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
      else steps.splice(steps.length - 1, 0, text);
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
    const first = this.steps;
    const second = other.steps;
    let i = 0;
    let j = 0;
    let a: Step | undefined = first[i++];
    let b: Step | undefined = second[j++];
    while (a !== undefined || b !== undefined) {
      if (isDelete(a)) {
        result.delete(-a);
        a = first[i++];
        continue;
      }
      if (isInsert(b)) {
        result.insert(b);
        b = second[j++];
        continue;
      }
      if (a === undefined || b === undefined) throw new OtError("incompatible");
      if (isRetain(a) && isRetain(b)) {
        const step = Math.min(a, b);
        result.retain(step);
        a = a > step ? a - step : first[i++];
        b = b > step ? b - step : second[j++];
      } else if (isInsert(a) && isDelete(b)) {
        const step = Math.min(a.length, -b);
        a = a.length > step ? splitAt(a, step)[1] : first[i++];
        b = -b > step ? b + step : second[j++];
      } else if (isInsert(a) && isRetain(b)) {
        const step = Math.min(a.length, b);
        const [head, tail] = splitAt(a, step);
        result.insert(head);
        a = a.length > step ? tail : first[i++];
        b = b > step ? b - step : second[j++];
      } else if (isRetain(a) && isDelete(b)) {
        const step = Math.min(a, -b);
        result.delete(step);
        a = a > step ? a - step : first[i++];
        b = -b > step ? b + step : second[j++];
      }
    }
    return result;
  }

  static transform(client: TextOperation, server: TextOperation): [TextOperation, TextOperation] {
    if (client.baseLength !== server.baseLength) throw new OtError("length_mismatch");
    const clientPrime = new TextOperation();
    const serverPrime = new TextOperation();
    const first = client.steps;
    const second = server.steps;
    let i = 0;
    let j = 0;
    let a: Step | undefined = first[i++];
    let b: Step | undefined = second[j++];
    while (a !== undefined || b !== undefined) {
      if (isInsert(a)) {
        serverPrime.retain(a.length);
        clientPrime.insert(a);
        a = first[i++];
        continue;
      }
      if (isInsert(b)) {
        clientPrime.retain(b.length);
        serverPrime.insert(b);
        b = second[j++];
        continue;
      }
      if (a === undefined || b === undefined) throw new OtError("incompatible");
      if (isRetain(a) && isRetain(b)) {
        const step = Math.min(a, b);
        clientPrime.retain(step);
        serverPrime.retain(step);
        a = a > step ? a - step : first[i++];
        b = b > step ? b - step : second[j++];
      } else if (isDelete(a) && isDelete(b)) {
        const step = Math.min(-a, -b);
        a = -a > step ? a + step : first[i++];
        b = -b > step ? b + step : second[j++];
      } else if (isDelete(a) && isRetain(b)) {
        const step = Math.min(-a, b);
        clientPrime.delete(step);
        a = -a > step ? a + step : first[i++];
        b = b > step ? b - step : second[j++];
      } else if (isRetain(a) && isDelete(b)) {
        const step = Math.min(a, -b);
        serverPrime.delete(step);
        a = a > step ? a - step : first[i++];
        b = -b > step ? b + step : second[j++];
      }
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
      if (last && last.to === position) last.to = position - step;
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
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) suffix -= 1;
  return new TextOperation()
    .retain(prefix)
    .insert(after.slice(prefix, after.length - suffix))
    .delete(before.length - suffix - prefix)
    .retain(suffix);
}
