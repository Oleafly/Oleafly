import type { ReservedShortcutAction } from "@/store/shortcuts";

export type SettingIssue =
  | { kind: "boolean" }
  | { kind: "oneOf"; values: readonly (string | number)[] }
  | { kind: "range"; min: number; max: number }
  | { kind: "wholeRange"; min: number; max: number; step: number }
  | { kind: "hexColor" }
  | { kind: "hexColorOrEmpty" }
  | { kind: "text"; max: number }
  | { kind: "list"; max: number }
  | { kind: "listItem" }
  | { kind: "duplicate" }
  | { kind: "object" }
  | { kind: "unknownKey" }
  | { kind: "dictionaryLocale" }
  | { kind: "shortcut" }
  | { kind: "editorKey" }
  | { kind: "reservedShortcut"; action: ReservedShortcutAction }
  | { kind: "detail"; message: string };

export type Parsed<T> = { ok: true; value: T } | { ok: false; issue: SettingIssue; at?: string };

export interface ValueType<T> {
  parse(raw: unknown): Parsed<T>;
}

export function ok<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

export function fail<T>(issue: SettingIssue, at?: string): Parsed<T> {
  return at === undefined ? { ok: false, issue } : { ok: false, issue, at };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CONTROL_CHARACTERS = /\p{Cc}/u;
const NUL_CHARACTER = /\0/u;
const HEX_COLOR = /^#[\da-f]{6}$/iu;

export const bool: ValueType<boolean> = {
  parse(raw) {
    if (raw === true || raw === 1 || raw === "on") return ok(true);
    if (raw === false || raw === 0 || raw === "off") return ok(false);
    return fail({ kind: "boolean" });
  },
};

export function oneOf<T extends string>(values: readonly T[]): ValueType<T> {
  return {
    parse(raw) {
      return typeof raw === "string" && (values as readonly string[]).includes(raw)
        ? ok(raw as T)
        : fail({ kind: "oneOf", values });
    },
  };
}

export function numberOf(values: readonly number[]): ValueType<number> {
  return {
    parse(raw) {
      return typeof raw === "number" && values.includes(raw) ? ok(raw) : fail({ kind: "oneOf", values });
    },
  };
}

export function wholeNumber(min: number, max: number, step = 1): ValueType<number> {
  return {
    parse(raw) {
      return typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= max && (raw - min) % step === 0
        ? ok(raw)
        : fail({ kind: "wholeRange", min, max, step });
    },
  };
}

export function decimal(min: number, max: number, normalize: (value: number) => number): ValueType<number> {
  return {
    parse(raw) {
      return typeof raw === "number" && Number.isFinite(raw) && raw >= min && raw <= max
        ? ok(normalize(raw))
        : fail({ kind: "range", min, max });
    },
  };
}

export const hexColor: ValueType<string> = {
  parse(raw) {
    return typeof raw === "string" && HEX_COLOR.test(raw) ? ok(raw.toLowerCase()) : fail({ kind: "hexColor" });
  },
};

export const hexColorOrEmpty: ValueType<string> = {
  parse(raw) {
    if (raw === "") return ok("");
    return typeof raw === "string" && HEX_COLOR.test(raw)
      ? ok(raw.toLowerCase())
      : fail({ kind: "hexColorOrEmpty" });
  },
};

function validText(raw: unknown, max: number, multiline: boolean): raw is string {
  if (typeof raw !== "string" || raw.length > max) return false;
  return !(multiline ? NUL_CHARACTER : CONTROL_CHARACTERS).test(raw);
}

export function text(max: number, options: { multiline?: boolean; required?: boolean } = {}): ValueType<string> {
  return {
    parse(raw) {
      if (!validText(raw, max, options.multiline ?? false)) return fail({ kind: "text", max });
      if (options.required && raw.trim() === "") return fail({ kind: "text", max });
      return ok(raw);
    },
  };
}

export function textList(maxItems: number, maxLength: number, accepts: (item: string) => boolean = () => true): ValueType<string[]> {
  return {
    parse(raw) {
      if (!Array.isArray(raw) || raw.length > maxItems) return fail({ kind: "list", max: maxItems });
      const seen = new Set<string>();
      for (const [index, item] of raw.entries()) {
        if (!validText(item, maxLength, false) || item.trim() === "" || !accepts(item)) {
          return fail({ kind: "listItem" }, `[${index}]`);
        }
        if (seen.has(item)) return fail({ kind: "duplicate" }, `[${index}]`);
        seen.add(item);
      }
      return ok([...seen]);
    },
  };
}
