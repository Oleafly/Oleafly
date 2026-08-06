import type {
  Node as LatexNode,
  Macro,
} from "@unified-latex/unified-latex-types";
import { location, stableId } from "./source";
import type { ProjectDefinition } from "./types";

// unified-latex is ~200 KB minified and must stay out of the synchronous
// main-thread bundle (performance budget). The parser loads lazily; until it
// arrives, astAugmentLatexFile returns null and callers keep lexical-only
// results — the next analysis pass picks the AST facts up.
interface UnifiedLatexApi {
  parse: typeof import("@unified-latex/unified-latex-util-parse").parse;
  printRaw: typeof import("@unified-latex/unified-latex-util-print-raw").printRaw;
}

let unifiedLatex: UnifiedLatexApi | null = null;
let unifiedLatexLoad: Promise<void> | null = null;

function ensureUnifiedLatexLoaded(): Promise<void> {
  unifiedLatexLoad ??= Promise.all([
    import("@unified-latex/unified-latex-util-parse"),
    import("@unified-latex/unified-latex-util-print-raw"),
  ])
    .then(([parseModule, printModule]) => {
      unifiedLatex = {
        parse: parseModule.parse,
        printRaw: printModule.printRaw,
      };
    })
    .catch((error: unknown) => {
      console.debug("[latex-ast] parser failed to load", error);
    });
  return unifiedLatexLoad;
}

/** Resolves when the AST parser is available (or has failed to load). */
export function latexAstReady(): Promise<void> {
  return ensureUnifiedLatexLoaded();
}

// The lexical scanner stays authoritative for macro/environment/label
// extraction; this pass only contributes what regexes cannot express
// reliably. Glossary entry arguments are plain brace groups that
// unified-latex leaves unattached for unknown macros, so definitions are
// recovered from sibling groups after the defining macro.

const MAX_AST_SOURCE_CHARACTERS = 1_000_000;
const MAX_DETAIL_CHARACTERS = 120;

const GLOSSARY_DEFINITION_MACROS = new Set([
  "newglossaryentry",
  "longnewglossaryentry",
  "newacronym",
  "newabbreviation",
]);

export interface AstAugmentation {
  readonly definitions: readonly ProjectDefinition[];
}

interface GroupLike {
  readonly type: "group";
  readonly content: LatexNode[];
  readonly position?: {
    readonly start: { readonly offset: number };
    readonly end: { readonly offset: number };
  };
}

function isMacro(node: LatexNode): node is Macro {
  return node.type === "macro";
}

function isGroup(node: LatexNode): node is LatexNode & GroupLike {
  return node.type === "group";
}

function trimmedRaw(
  api: UnifiedLatexApi,
  nodes: readonly LatexNode[],
): string {
  return api.printRaw(nodes as LatexNode[]).trim();
}

/**
 * Collect the brace-group arguments following an unknown macro, skipping an
 * optional leading `[...]` written as loose string tokens.
 */
function siblingGroups(
  siblings: readonly LatexNode[],
  start: number,
  count: number,
): GroupLike[] {
  const groups: GroupLike[] = [];
  let inOptional = false;
  for (
    let cursor = start;
    cursor < siblings.length && groups.length < count;
    cursor++
  ) {
    const node = siblings[cursor];
    if (node.type === "whitespace" || node.type === "parbreak") {
      continue;
    }
    if (node.type === "string") {
      if (node.content === "[") {
        inOptional = true;
        continue;
      }
      if (node.content === "]" && inOptional) {
        inOptional = false;
        continue;
      }
      if (inOptional) continue;
      break;
    }
    if (inOptional) continue;
    if (isGroup(node)) {
      groups.push(node);
      continue;
    }
    break;
  }
  return groups;
}

function glossaryDefinition(
  api: UnifiedLatexApi,
  file: string,
  starts: readonly number[],
  macro: Macro,
  siblings: readonly LatexNode[],
  index: number,
): ProjectDefinition | null {
  const macroArgs = (macro.args ?? [])
    .filter((argument) => argument.openMark === "{")
    .map((argument) => argument as unknown as GroupLike);
  const groups = macroArgs.length
    ? macroArgs
    : siblingGroups(siblings, index + 1, 3);
  const keyGroup = groups[0];
  if (!keyGroup) return null;
  const name = trimmedRaw(api, keyGroup.content);
  if (!name || /[\\{}]/.test(name)) return null;
  const position = keyGroup.position;
  if (!position) return null;
  const from = position.start.offset + 1;
  const to = Math.max(from, position.end.offset - 1);
  const isAcronym =
    macro.content === "newacronym" ||
    macro.content === "newabbreviation";
  let detail = "glossary entry";
  if (isAcronym && groups.length >= 3) {
    detail = `${trimmedRaw(api, groups[1].content)}, ${trimmedRaw(api, groups[2].content)}`;
  } else if (!isAcronym && groups.length >= 2) {
    const nameField = /name\s*=\s*\{?([^,{}]+)/u.exec(
      trimmedRaw(api, groups[1].content),
    );
    if (nameField) detail = nameField[1].trim();
  }
  return {
    id: stableId("def", "local", file, from, "glossary", name),
    source: "local",
    engine: "latex",
    kind: "glossary",
    name,
    location: location(file, starts, from, to),
    detail: detail.slice(0, MAX_DETAIL_CHARACTERS),
  };
}

function walk(
  api: UnifiedLatexApi,
  file: string,
  starts: readonly number[],
  nodes: readonly LatexNode[],
  definitions: ProjectDefinition[],
): void {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (
      isMacro(node) &&
      GLOSSARY_DEFINITION_MACROS.has(node.content)
    ) {
      const definition = glossaryDefinition(
        api,
        file,
        starts,
        node,
        nodes,
        index,
      );
      if (definition) definitions.push(definition);
      continue;
    }
    const children =
      "content" in node && Array.isArray(node.content)
        ? (node.content as LatexNode[])
        : null;
    if (children) {
      walk(api, file, starts, children, definitions);
    }
  }
}

/**
 * Parse a LaTeX file with unified-latex and extract structures the lexical
 * scanner misses. Returns null when the source is too large or the parse
 * fails; callers fall back to lexical-only results.
 */
export function astAugmentLatexFile(
  file: string,
  source: string,
  starts: readonly number[],
): AstAugmentation | null {
  if (source.length > MAX_AST_SOURCE_CHARACTERS) return null;
  if (!/\\(?:new(?:glossaryentry|acronym|abbreviation)|longnewglossaryentry)/.test(source)) {
    return null;
  }
  const api = unifiedLatex;
  if (!api) {
    void ensureUnifiedLatexLoaded();
    return null;
  }
  try {
    const ast = api.parse(source);
    const definitions: ProjectDefinition[] = [];
    walk(api, file, starts, ast.content, definitions);
    return definitions.length ? { definitions } : null;
  } catch {
    return null;
  }
}
