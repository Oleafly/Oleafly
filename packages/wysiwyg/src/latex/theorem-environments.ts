import { stripLatexComments } from "./arguments";

export const STANDARD_THEOREM_ENVIRONMENTS = [
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "definition",
  "remark",
  "example",
  "proof",
  "conjecture",
  "claim",
  "axiom",
  "notation",
] as const;

export type StandardTheoremEnvironment = (typeof STANDARD_THEOREM_ENVIRONMENTS)[number];

const NEW_THEOREM = /\\newtheorem\*?\s*\{([^{}]+)\}/gu;
const DECLARE_THEOREM = /\\declaretheorem(?:\s*\[[^\][]*\])?\s*\{([^{}]+)\}/gu;

export function theoremEnvironmentsFromPreamble(preamble: string): string[] {
  const names = new Set<string>();
  const source = stripLatexComments(preamble);
  for (const pattern of [NEW_THEOREM, DECLARE_THEOREM]) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1].trim();
      if (/^[A-Za-z][A-Za-z0-9*]*$/u.test(name)) names.add(name);
    }
  }
  return [...names];
}

export function theoremEnvironmentSet(extra: readonly string[] = []): ReadonlySet<string> {
  return new Set<string>([...STANDARD_THEOREM_ENVIRONMENTS, ...extra]);
}
