import { scanMacroArguments, stripLatexComments } from "./arguments";

export interface LatexStatement {
  name: string;
  starred: boolean;
  optional: string | null;
  mandatory: string[];
}

export function scanStatements(body: string): LatexStatement[] | null {
  const text = stripLatexComments(body);
  const statements: LatexStatement[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (/\s/u.test(text[cursor])) {
      cursor++;
      continue;
    }
    const match = /^\\([A-Za-z]+)/u.exec(text.slice(cursor));
    if (!match) return null;
    const scanned = scanMacroArguments(text, cursor + match[0].length);
    const optional = scanned.args.filter((arg) => arg.kind === "optional");
    if (optional.length > 1) return null;
    statements.push({
      name: match[1],
      starred: scanned.starred,
      optional: optional[0]?.value ?? null,
      mandatory: scanned.args.filter((arg) => arg.kind === "mandatory").map((arg) => arg.value),
    });
    cursor = scanned.end;
  }
  return statements;
}

export function singleMandatory(statement: LatexStatement): string | null {
  if (statement.starred || statement.optional !== null || statement.mandatory.length !== 1) return null;
  return statement.mandatory[0];
}

export function isBareStatement(statement: LatexStatement): boolean {
  return !statement.starred && statement.optional === null && statement.mandatory.length === 0;
}
