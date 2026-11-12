import type { Diagnostic } from "./analyze";
import type { TermToken } from "./lexer";
import type { QueryNode } from "./parser";

const MAX_QUERY_BRANCHES = 32;

export type LeafExpansion<L> = (term: TermToken, negated: boolean) => readonly (readonly L[])[] | null;

export interface QueryExpansion<L> {
  readonly conjunctions: (readonly L[])[];
  readonly truncated: boolean;
}

function expandNode<L>(
  node: QueryNode,
  leaf: LeafExpansion<L>,
  negated: boolean,
  limit: number,
  cut: () => void,
): (readonly L[])[] | null {
  const capped = (branches: (readonly L[])[]) => {
    if (branches.length <= limit) return branches;
    cut();
    return branches.slice(0, limit);
  };
  if (node.type === "term") {
    const found = leaf(node.term, negated);
    return found ? capped([...found]) : null;
  }
  if (node.type === "not") return expandNode(node.child, leaf, !negated, limit, cut);
  const parts = node.children
    .map((child) => expandNode(child, leaf, negated, limit, cut))
    .filter((part): part is (readonly L[])[] => part !== null);
  if (parts.length === 0) return null;
  if ((node.type === "or") !== negated) return capped(parts.flat());
  return parts.reduce<(readonly L[])[]>((left, right) => capped(left.flatMap((a) => right.map((b) => [...a, ...b]))), [[]]);
}

export function expandQuery<L>(
  root: QueryNode | null,
  leaf: LeafExpansion<L>,
  limit = MAX_QUERY_BRANCHES,
): QueryExpansion<L> | null {
  if (!root) return null;
  let truncated = false;
  const conjunctions = expandNode(root, leaf, false, limit, () => {
    truncated = true;
  });
  return conjunctions ? { conjunctions, truncated } : null;
}

export function truncatedDiagnostic(source: string): Diagnostic {
  const end = source.length;
  return { code: "too-many-branches", span: { start: end, end } };
}
