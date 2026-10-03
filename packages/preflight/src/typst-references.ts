import {
  type TypstCall,
  type TypstScan,
  callAt,
  type TypstStringValue,
  TYPST_CODE,
  TYPST_LABEL,
  isExternalTypstPath,
  positionalArgument,
  stringValue,
  stringsWithin,
  typstCalls,
  typstMethodCalls,
  typstShowRuleCalls,
  unescapeTypstString,
} from "./typst-scan";

export type TypstPathKind = "image" | "include" | "bibliography" | "data";

export interface TypstPathReference {
  readonly kind: TypstPathKind;
  readonly raw: string;
  readonly from: number;
  readonly to: number;
  readonly callFrom: number;
  readonly callTo: number;
}

export interface TypstNameUse {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

const DATA_CALLS = ["read", "csv", "json", "yaml", "toml", "xml", "cbor"];

function bibliographyWithCalls(scan: TypstScan): TypstCall[] {
  return [...scan.code.matchAll(/(?<![\p{L}\p{N}_.-])bibliography\.with\s*\(/gu)].map((match) =>
    callAt(scan, "bibliography", match.index, match.index + match[0].length - 1),
  );
}

function firstStringArguments(scan: TypstScan, calls: readonly TypstCall[]): { name: string; callFrom: number; callTo: number; values: TypstStringValue[] }[] {
  return calls.flatMap((call) => {
    const arg = positionalArgument(scan, call);
    if (!arg) return [];
    const single = stringValue(scan, arg.valueFrom, arg.valueTo);
    const values = single
      ? [single]
      : scan.code[arg.valueFrom] === "(" && call.name === "bibliography"
        ? stringsWithin(scan, arg.valueFrom, arg.valueTo)
        : [];
    return values.length > 0 ? [{ name: call.name, callFrom: call.from, callTo: call.close + 1, values }] : [];
  });
}

function statementPaths(scan: TypstScan): TypstPathReference[] {
  const out: TypstPathReference[] = [];
  for (const match of scan.code.matchAll(/(?<![\p{L}\p{N}_.-])(include|import)\s+"/gu)) {
    const quote = match.index + match[0].length - 1;
    const literal = scan.strings.find((item) => item.from === quote + 1);
    if (!literal) continue;
    const raw = unescapeTypstString(scan.text.slice(literal.from, literal.to));
    if (isExternalTypstPath(raw)) continue;
    out.push({ kind: "include", raw, from: literal.from, to: literal.to, callFrom: match.index, callTo: literal.to + 1 });
  }
  return out;
}

function namedBibliographyFiles(scan: TypstScan): TypstPathReference[] {
  const out: TypstPathReference[] = [];
  for (const match of scan.code.matchAll(/(?<![\p{L}\p{N}_.-])bibliography-file\s*:\s*"/gu)) {
    const quote = match.index + match[0].length - 1;
    const literal = scan.strings.find((item) => item.from === quote + 1);
    if (!literal) continue;
    out.push({
      kind: "bibliography",
      raw: unescapeTypstString(scan.text.slice(literal.from, literal.to)),
      from: literal.from,
      to: literal.to,
      callFrom: match.index,
      callTo: literal.to + 1,
    });
  }
  return out;
}

export function typstPathReferences(scan: TypstScan): TypstPathReference[] {
  const calls = firstStringArguments(scan, [
    ...typstCalls(scan, ["image", "bibliography", ...DATA_CALLS]),
    ...bibliographyWithCalls(scan),
  ]).flatMap((call) =>
    call.values.map((value): TypstPathReference => ({
      kind: call.name === "image" ? "image" : call.name === "bibliography" ? "bibliography" : "data",
      raw: value.value,
      from: value.from,
      to: value.to,
      callFrom: call.callFrom,
      callTo: call.callTo,
    })),
  );
  return [...calls, ...statementPaths(scan), ...namedBibliographyFiles(scan)].sort((a, b) => a.from - b.from);
}

function importedName(item: string): string {
  const words = item.split(/\s+/);
  const alias = words.indexOf("as");
  return alias > 0 && alias + 1 < words.length ? words[alias + 1] : item;
}

export function typstPackageImportNames(scan: TypstScan): string[] {
  const names: string[] = [];
  for (const match of scan.masked.matchAll(/#import\s+"@[^"\n]+"\s*:\s*([^\n]+)/g)) {
    for (const item of match[1].split(",")) {
      const name = importedName(item.replaceAll(/[()]/g, "").trim());
      if (/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(name)) names.push(name);
    }
  }
  return names;
}

export function typstTemplateCalls(scan: TypstScan): TypstCall[] {
  const imported = typstPackageImportNames(scan);
  return [
    ...typstShowRuleCalls(scan),
    ...typstMethodCalls(scan, "with"),
    ...(imported.length > 0 ? typstCalls(scan, imported) : []),
  ];
}

export function typstHasBibliography(scan: TypstScan): boolean {
  return /(?<![\p{L}\p{N}_.-])(?:[\p{L}\p{N}_-]*bibliography(?:\.with)?\s*\(|bibliography(?:-file)?\s*:(?!\s*none\b))/u.test(
    scan.code,
  );
}

export function typstLabels(scan: TypstScan): TypstNameUse[] {
  const out: TypstNameUse[] = [];
  for (const match of scan.markup.matchAll(new RegExp(`<(${TYPST_LABEL})>`, "gu"))) {
    out.push({ name: match[1], from: match.index, to: match.index + match[0].length });
  }
  return out;
}

function trimReference(name: string): string {
  let end = name.length;
  while (end > 0 && (name[end - 1] === "." || name[end - 1] === ":")) end--;
  return name.slice(0, end);
}

export function typstAtReferences(scan: TypstScan): TypstNameUse[] {
  const out: TypstNameUse[] = [];
  const pattern = new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}\p{Pc}])@(${TYPST_LABEL})`, "gu");
  for (const match of scan.markup.matchAll(pattern)) {
    const name = trimReference(match[1]);
    if (!name) continue;
    out.push({ name, from: match.index, to: match.index + 1 + name.length });
  }
  return out;
}

function labelArguments(scan: TypstScan, name: string): TypstNameUse[] {
  const out: TypstNameUse[] = [];
  for (const call of typstCalls(scan, [name])) {
    const args = scan.text.slice(call.open, call.close);
    for (const match of args.matchAll(new RegExp(`<(${TYPST_LABEL})>`, "gu"))) {
      const from = call.open + match.index;
      if (scan.kinds[from] !== TYPST_CODE) continue;
      out.push({ name: match[1], from: call.from, to: call.close + 1 });
    }
    for (const labelCall of typstCalls(scan, ["label"])) {
      if (labelCall.from < call.open || labelCall.from > call.close) continue;
      const arg = positionalArgument(scan, labelCall);
      const value = arg && stringValue(scan, arg.valueFrom, arg.valueTo);
      if (value?.value) out.push({ name: value.value, from: call.from, to: call.close + 1 });
    }
  }
  return out;
}

export function typstRefCalls(scan: TypstScan): TypstNameUse[] {
  return labelArguments(scan, "ref");
}

export function typstCiteCalls(scan: TypstScan): TypstNameUse[] {
  return labelArguments(scan, "cite");
}
