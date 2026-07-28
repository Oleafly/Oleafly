import { parseFile } from "@/lib/index/parse-file";
import type { Sym } from "@/lib/index/types";
import { parseBibtexIntelligence } from "./parse-bibtex";
import {
  engineForPath,
  lineStarts,
  location,
  maskLatexComments,
  maskTypstComments,
  rangeFromOffsets,
  resolveProjectPath,
  sourceHash,
  stableId,
} from "./source";
import type {
  FileIntelligence,
  OutlineNode,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectDiagnostic,
  ProjectEdge,
  ProjectIntelligenceEngine,
  ProjectUse,
  ProjectUseKind,
  SourceRange,
} from "./types";

function definitionKind(
  symbol: Sym,
): ProjectDefinitionKind | null {
  switch (symbol.kind) {
    case "section":
    case "label":
    case "macro":
    case "environment":
    case "bibentry":
      return symbol.kind;
    case "theorem":
      return "environment";
    case "glossary":
      return "label";
    default:
      return null;
  }
}

function projectUseKind(
  symbol: Sym,
  source: string,
): ProjectUseKind | null {
  switch (symbol.kind) {
    case "ref":
    case "atuse":
      return "reference";
    case "cite":
      return "citation";
    case "macrouse":
      return "macro";
    case "envuse":
      return "environment";
    case "inputedge":
      return source.slice(symbol.from, symbol.to).includes("import")
        ? "import"
        : "include";
    default:
      return null;
  }
}

function uniqueById<T extends { readonly id: string }>(
  values: readonly T[],
): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

function addDelimiterDiagnostics(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  engine: ProjectIntelligenceEngine,
  diagnostics: ProjectDiagnostic[],
): boolean {
  const pairs: Record<string, string> =
    engine === "latex"
      ? { "{": "}" }
      : engine === "typst"
        ? { "{": "}", "[": "]", "(": ")" }
        : {};
  const closers = new Set(Object.values(pairs));
  const stack: { char: string; offset: number }[] = [];
  let quote = false;
  let partial = false;
  for (let offset = 0; offset < masked.length; offset++) {
    const char = masked[offset];
    if (engine === "typst" && char === '"' && masked[offset - 1] !== "\\") {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (engine === "latex") {
      let escapes = 0;
      for (
        let cursor = offset - 1;
        cursor >= 0 && masked[cursor] === "\\";
        cursor--
      ) {
        escapes++;
      }
      if (escapes % 2 === 1) continue;
    }
    if (char in pairs) {
      stack.push({ char, offset });
      continue;
    }
    if (!closers.has(char)) continue;
    const expected = stack.at(-1);
    if (expected && pairs[expected.char] === char) {
      stack.pop();
      continue;
    }
    partial = true;
    const diagnosticLocation = location(
      file,
      starts,
      offset,
      offset + 1,
    );
    diagnostics.push({
      id: stableId("diag", file, offset, "unexpected-delimiter", char),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: `Unexpected closing delimiter "${char}".`,
      location: diagnosticLocation,
      related: [],
    });
  }
  for (const unmatched of stack.slice(-32)) {
    partial = true;
    const expected = pairs[unmatched.char];
    const diagnosticLocation = location(
      file,
      starts,
      unmatched.offset,
      unmatched.offset + 1,
    );
    diagnostics.push({
      id: stableId(
        "diag",
        file,
        unmatched.offset,
        "unclosed-delimiter",
        unmatched.char,
      ),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: `Delimiter "${unmatched.char}" is not closed with "${expected}".`,
      location: diagnosticLocation,
      related: [],
    });
  }
  if (engine === "typst" && quote) {
    partial = true;
    const offset = Math.max(0, source.lastIndexOf('"'));
    diagnostics.push({
      id: stableId("diag", file, offset, "unclosed-string"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: "String literal is not closed.",
      location: location(file, starts, offset, offset + 1),
      related: [],
    });
  }
  return partial;
}

function latexEnvironmentDiagnostics(
  file: string,
  masked: string,
  starts: readonly number[],
  diagnostics: ProjectDiagnostic[],
): boolean {
  const stack: { name: string; from: number; to: number }[] = [];
  let partial = false;
  const expression = /\\(begin|end)\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(expression)) {
    const name = match[2].trim();
    if (!name) continue;
    if (match[1] === "begin") {
      stack.push({
        name,
        from: match.index,
        to: match.index + match[0].length,
      });
      continue;
    }
    const open = stack.at(-1);
    if (open?.name === name) {
      stack.pop();
      continue;
    }
    partial = true;
    diagnostics.push({
      id: stableId("diag", file, match.index, "environment-end", name),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: open
        ? `Expected \\end{${open.name}} before \\end{${name}}.`
        : `\\end{${name}} has no matching \\begin.`,
      location: location(
        file,
        starts,
        match.index,
        match.index + match[0].length,
      ),
      related: open
        ? [
            {
              message: `\\begin{${open.name}} is here.`,
              location: location(file, starts, open.from, open.to),
            },
          ]
        : [],
    });
  }
  for (const open of stack.slice(-32)) {
    partial = true;
    diagnostics.push({
      id: stableId("diag", file, open.from, "environment-open", open.name),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: `\\begin{${open.name}} has no matching \\end.`,
      location: location(file, starts, open.from, open.to),
      related: [],
    });
  }
  return partial;
}

function addUse(
  list: ProjectUse[],
  engine: ProjectIntelligenceEngine,
  file: string,
  starts: readonly number[],
  kind: ProjectUseKind,
  name: string,
  from: number,
  to: number,
  target?: string,
  syntax?: ProjectUse["syntax"],
): ProjectUse {
  const use: ProjectUse = {
    id: stableId("use", "local", file, from, kind, name),
    source: "local",
    engine,
    kind,
    name,
    location: location(file, starts, from, to),
    ...(target ? { target } : {}),
    ...(syntax ? { syntax } : {}),
    resolution: "unresolved",
    definitionIds: [],
  };
  list.push(use);
  return use;
}

function addDefinition(
  list: ProjectDefinition[],
  engine: ProjectIntelligenceEngine,
  file: string,
  starts: readonly number[],
  kind: ProjectDefinitionKind,
  name: string,
  from: number,
  to: number,
  detail?: string,
  level?: number,
): ProjectDefinition {
  const definition: ProjectDefinition = {
    id: stableId("def", "local", file, from, kind, name),
    source: "local",
    engine,
    kind,
    name,
    location: location(file, starts, from, to),
    ...(detail ? { detail } : {}),
    ...(level === undefined ? {} : { level }),
  };
  list.push(definition);
  return definition;
}

function edgeForUse(
  use: ProjectUse,
  targetFile: string | null,
): ProjectEdge {
  const kind =
    use.kind === "include" ||
    use.kind === "import" ||
    use.kind === "link" ||
    use.kind === "asset" ||
    use.kind === "bibliography"
      ? use.kind
      : "link";
  return {
    id: stableId("edge", use.location.file, use.location.range.from, kind),
    kind,
    fromFile: use.location.file,
    location: use.location,
    rawTarget: use.name,
    targetFile,
    resolution: targetFile ? "unresolved" : "external",
    candidateFiles: [],
  };
}

function outlineForDefinitions(
  file: string,
  definitions: readonly ProjectDefinition[],
  fullRanges: ReadonlyMap<string, SourceRange>,
): OutlineNode[] {
  const ordered = definitions
    .filter((definition) =>
      [
        "section",
        "label",
        "macro",
        "environment",
        "bibentry",
      ].includes(definition.kind),
    )
    .sort(
      (left, right) =>
        left.location.range.from - right.location.range.from ||
        left.id.localeCompare(right.id),
    );
  const outline: OutlineNode[] = [];
  const sectionStack: { level: number; id: string }[] = [];
  for (const definition of ordered) {
    const isSection = definition.kind === "section";
    const level = isSection
      ? Math.max(0, definition.level ?? 0)
      : sectionStack.length > 0
        ? sectionStack.at(-1)?.level ?? 0
        : 0;
    if (isSection) {
      while (
        sectionStack.length > 0 &&
        (sectionStack.at(-1)?.level ?? 0) >= level
      ) {
        sectionStack.pop();
      }
    }
    const id = stableId(
      "outline",
      file,
      definition.location.range.from,
      definition.kind,
    );
    outline.push({
      id,
      file,
      title: definition.name,
      kind: definition.kind,
      level,
      parentId: sectionStack.at(-1)?.id ?? null,
      range: fullRanges.get(definition.id) ?? definition.location.range,
      definitionId: definition.id,
    });
    if (isSection) sectionStack.push({ level, id });
  }
  return outline;
}

function latexAdditionalSyntax(
  file: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  const commandDefinition =
    /\\(?:NewDocumentCommand|RenewDocumentCommand|ProvideDocumentCommand|DeclareRobustCommand)\*?\s*\{?\s*\\([A-Za-z@]+)/g;
  for (const match of masked.matchAll(commandDefinition)) {
    const nameOffset =
      match.index + match[0].lastIndexOf(`\\${match[1]}`) + 1;
    addDefinition(
      definitions,
      "latex",
      file,
      starts,
      "macro",
      match[1],
      nameOffset,
      nameOffset + match[1].length,
    );
  }

  const environmentDefinition =
    /\\(?:NewDocumentEnvironment|RenewDocumentEnvironment|ProvideDocumentEnvironment)\*?\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(environmentDefinition)) {
    const nameOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    addDefinition(
      definitions,
      "latex",
      file,
      starts,
      "environment",
      match[1].trim(),
      nameOffset,
      nameOffset + match[1].length,
    );
  }

  const anchor = /\\hypertarget\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(anchor)) {
    const nameOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    addDefinition(
      definitions,
      "latex",
      file,
      starts,
      "anchor",
      match[1].trim(),
      nameOffset,
      nameOffset + match[1].length,
    );
  }

  const hyperlink = /\\hyperlink\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(hyperlink)) {
    const nameOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    addUse(
      uses,
      "latex",
      file,
      starts,
      "reference",
      match[1].trim(),
      nameOffset,
      nameOffset + match[1].length,
    );
  }

  const inputCommands =
    /\\(input|include|subfile|InputIfFileExists)\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(inputCommands)) {
    if (match[1] === "input" || match[1] === "include") continue;
    const raw = match[2].trim();
    const nameOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "latex",
      file,
      starts,
      "include",
      raw,
      nameOffset,
      nameOffset + match[2].length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }

  const imports =
    /\\(import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)\*?\s*\{([^}]*)\}\s*\{([^}]*)\}/gi;
  for (const match of masked.matchAll(imports)) {
    const raw = `${match[2].trim().replace(/\/+$/, "")}/${match[3].trim()}`;
    const nameOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "latex",
      file,
      starts,
      "import",
      raw,
      nameOffset,
      nameOffset + match[3].length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }

  const assets =
    /\\(?:includegraphics|includesvg|includepdf)\*?(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(assets)) {
    const raw = match[1].trim();
    const nameOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "latex",
      file,
      starts,
      "asset",
      raw,
      nameOffset,
      nameOffset + match[1].length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }

  const bibliographies =
    /\\(?:bibliography|addbibresource)\*?(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(bibliographies)) {
    const valueOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    for (const keyMatch of match[1].matchAll(/[^,]+/g)) {
      const rawSegment = keyMatch[0];
      const raw = rawSegment.trim();
      if (!raw) continue;
      const leading = rawSegment.length - rawSegment.trimStart().length;
      const nameOffset = valueOffset + keyMatch.index + leading;
      const target = resolveProjectPath(file, raw, ".bib");
      const use = addUse(
        uses,
        "latex",
        file,
        starts,
        "bibliography",
        raw,
        nameOffset,
        nameOffset + raw.length,
        target ?? undefined,
      );
      edges.push(edgeForUse(use, target));
    }
  }

  // Keep command candidates in the per-file cache. Project assembly retains
  // only names actually defined by this project, avoiding false "unknown
  // command" findings for the LaTeX/package command universe.
  const commandUse = /\\([A-Za-z@]+)/g;
  for (const match of masked.matchAll(commandUse)) {
    const nameOffset = match.index + 1;
    addUse(
      uses,
      "latex",
      file,
      starts,
      "macro",
      match[1],
      nameOffset,
      nameOffset + match[1].length,
      undefined,
      "candidate",
    );
  }
}

function markdownSlug(title: string): string {
  return title
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~[\]()]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function markdownAdditionalSyntax(
  file: string,
  source: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
  diagnostics: ProjectDiagnostic[],
): boolean {
  const chars = source.split("");
  const lines = source.split("\n");
  let offset = 0;
  let fence:
    | { char: "`" | "~"; length: number; offset: number }
    | null = null;
  let yaml = source.startsWith("---\n");
  let yamlBibliographyList = false;
  let partial = false;

  for (const [lineIndex, line] of lines.entries()) {
    if (yaml) {
      if (lineIndex > 0 && /^(?:---|\.\.\.)\s*$/.test(line)) {
        yaml = false;
        yamlBibliographyList = false;
        offset += line.length + 1;
        continue;
      }
      const declaration =
        /^bibliography\s*:\s*(.*)\s*$/i.exec(line);
      if (declaration) {
        yamlBibliographyList = declaration[1].trim().length === 0;
        const rawValue = declaration[1].trim();
        const values = rawValue.startsWith("[") && rawValue.endsWith("]")
          ? rawValue.slice(1, -1).split(",")
          : rawValue
            ? [rawValue]
            : [];
        for (const value of values) {
          const raw = value.trim().replace(/^["']|["']$/g, "");
          if (!raw) continue;
          const nameOffset = offset + line.indexOf(value) +
            value.indexOf(raw);
          const target = resolveProjectPath(file, raw, ".bib");
          const use = addUse(
            uses,
            "markdown",
            file,
            starts,
            "bibliography",
            raw,
            nameOffset,
            nameOffset + raw.length,
            target ?? undefined,
          );
          edges.push(edgeForUse(use, target));
        }
      } else if (yamlBibliographyList) {
        const item = /^\s*-\s*(.+?)\s*$/.exec(line);
        if (item) {
          const raw = item[1].trim().replace(/^["']|["']$/g, "");
          const nameOffset = offset + line.lastIndexOf(item[1]) +
            item[1].indexOf(raw);
          const target = resolveProjectPath(file, raw, ".bib");
          const use = addUse(
            uses,
            "markdown",
            file,
            starts,
            "bibliography",
            raw,
            nameOffset,
            nameOffset + raw.length,
            target ?? undefined,
          );
          edges.push(edgeForUse(use, target));
        } else if (/^\S/.test(line)) {
          yamlBibliographyList = false;
        }
      }
      for (let index = offset; index < offset + line.length; index++) {
        chars[index] = " ";
      }
      offset += line.length + 1;
      continue;
    }

    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      const char = marker[0] as "`" | "~";
      if (!fence) {
        fence = { char, length: marker.length, offset };
      } else if (char === fence.char && marker.length >= fence.length) {
        fence = null;
      }
      for (let index = offset; index < offset + line.length; index++) {
        chars[index] = " ";
      }
      offset += line.length + 1;
      continue;
    }
    if (fence) {
      for (let index = offset; index < offset + line.length; index++) {
        chars[index] = " ";
      }
      offset += line.length + 1;
      continue;
    }
    for (const inline of line.matchAll(/(`+)([\s\S]*?)\1/g)) {
      const from = offset + inline.index;
      for (let index = from; index < from + inline[0].length; index++) {
        chars[index] = " ";
      }
    }
    offset += line.length + 1;
  }

  if (fence) {
    partial = true;
    diagnostics.push({
      id: stableId("diag", file, fence.offset, "markdown-fence"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: "Fenced code block is not closed.",
      location: location(
        file,
        starts,
        fence.offset,
        Math.min(source.length, fence.offset + fence.length),
      ),
      related: [],
    });
  }
  if (yaml) {
    partial = true;
    diagnostics.push({
      id: stableId("diag", file, 0, "markdown-frontmatter"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: "YAML front matter is not closed.",
      location: location(file, starts, 0, Math.min(source.length, 3)),
      related: [],
    });
  }

  const visible = chars.join("");
  const explicitAnchor =
    /\{#([A-Za-z][A-Za-z0-9_.:-]*)\}/g;
  for (const match of visible.matchAll(explicitAnchor)) {
    const nameOffset = match.index + 2;
    addDefinition(
      definitions,
      "markdown",
      file,
      starts,
      "anchor",
      match[1],
      nameOffset,
      nameOffset + match[1].length,
    );
  }

  for (const heading of definitions.filter(
    (definition) => definition.kind === "section",
  )) {
    const lineText =
      lines[heading.location.range.startLine - 1] ?? heading.name;
    const explicit = /\{#([A-Za-z][A-Za-z0-9_.:-]*)\}\s*#*\s*$/.exec(
      lineText,
    )?.[1];
    const name = explicit ?? markdownSlug(heading.name);
    if (!name) continue;
    const existing = definitions.some(
      (definition) =>
        definition.kind === "anchor" &&
        definition.name === name &&
        definition.location.range.startLine ===
          heading.location.range.startLine,
    );
    if (!existing) {
      addDefinition(
        definitions,
        "markdown",
        file,
        starts,
        "anchor",
        name,
        heading.location.range.from,
        heading.location.range.to,
        explicit ? "Explicit Pandoc identifier" : "Pandoc auto identifier",
      );
    }
  }

  const link =
    /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of visible.matchAll(link)) {
    const target = match[3];
    const targetOffset = match.index + match[0].indexOf(target);
    const image = match[1] === "!";
    const hash = target.indexOf("#");
    const targetPath = hash >= 0 ? target.slice(0, hash) : target;
    const anchor = hash >= 0 ? target.slice(hash + 1) : "";
    if (!targetPath && anchor) {
      addUse(
        uses,
        "markdown",
        file,
        starts,
        "reference",
        anchor,
        targetOffset + 1,
        targetOffset + target.length,
      );
      continue;
    }
    const resolved = resolveProjectPath(file, targetPath);
    const kind: ProjectUseKind = image ? "asset" : "link";
    const use = addUse(
      uses,
      "markdown",
      file,
      starts,
      kind,
      target,
      targetOffset,
      targetOffset + target.length,
      resolved ?? undefined,
    );
    edges.push(edgeForUse(use, resolved));
    if (anchor) {
      addUse(
        uses,
        "markdown",
        file,
        starts,
        "reference",
        anchor,
        targetOffset + hash + 1,
        targetOffset + target.length,
        resolved ? `${resolved}#${anchor}` : undefined,
      );
    }
  }

  const referenceDefinition =
    /^\s{0,3}\[([^\]\n]+)\]:\s*<?([^>\s]+)>?/gm;
  for (const match of visible.matchAll(referenceDefinition)) {
    const nameOffset = match.index + match[0].indexOf(match[1]);
    addDefinition(
      definitions,
      "markdown",
      file,
      starts,
      "anchor",
      match[1].toLocaleLowerCase("en-US"),
      nameOffset,
      nameOffset + match[1].length,
      "Markdown link definition",
    );
    const targetOffset = match.index + match[0].indexOf(match[2]);
    const resolved = resolveProjectPath(file, match[2]);
    const use = addUse(
      uses,
      "markdown",
      file,
      starts,
      "link",
      match[2],
      targetOffset,
      targetOffset + match[2].length,
      resolved ?? undefined,
    );
    edges.push(edgeForUse(use, resolved));
  }

  const referenceUse =
    /(?<!!)\[([^\]\n]+)\]\[([^\]\n]*)\]/g;
  for (const match of visible.matchAll(referenceUse)) {
    const name = (match[2] || match[1]).toLocaleLowerCase("en-US");
    const sourceName = match[2] || match[1];
    const nameOffset = match.index + match[0].lastIndexOf(sourceName);
    addUse(
      uses,
      "markdown",
      file,
      starts,
      "reference",
      name,
      nameOffset,
      nameOffset + sourceName.length,
    );
  }

  const include =
    /^(?:\s*!include\s+|\s*\{\{<?\s*include\s+|\s*\{%\s*include\s+)(["']?)([^"'\s}%>]+)\1/gm;
  for (const match of visible.matchAll(include)) {
    const raw = match[2];
    const nameOffset = match.index + match[0].lastIndexOf(raw);
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "markdown",
      file,
      starts,
      "include",
      raw,
      nameOffset,
      nameOffset + raw.length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }
  return partial;
}

function typstAdditionalSyntax(
  file: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  const letDefinition = /#let\s+([A-Za-z_][A-Za-z0-9_-]*)/g;
  for (const match of masked.matchAll(letDefinition)) {
    const nameOffset = match.index + match[0].lastIndexOf(match[1]);
    addDefinition(
      definitions,
      "typst",
      file,
      starts,
      "macro",
      match[1],
      nameOffset,
      nameOffset + match[1].length,
      "Typst binding",
    );
  }

  const bibliography = /#bibliography\s*\(([^)]*)\)/g;
  for (const match of masked.matchAll(bibliography)) {
    const argumentsOffset = match.index + match[0].indexOf(match[1]);
    for (const pathMatch of match[1].matchAll(/"([^"]+)"/g)) {
      const raw = pathMatch[1];
      const nameOffset =
        argumentsOffset + pathMatch.index + pathMatch[0].indexOf(raw);
      const target = resolveProjectPath(file, raw, ".bib");
      const use = addUse(
        uses,
        "typst",
        file,
        starts,
        "bibliography",
        raw,
        nameOffset,
        nameOffset + raw.length,
        target ?? undefined,
      );
      edges.push(edgeForUse(use, target));
    }
  }

  const assets =
    /#(?:image|read|csv|json|yaml|xml)\s*\(\s*"([^"]+)"/g;
  for (const match of masked.matchAll(assets)) {
    const raw = match[1];
    const nameOffset = match.index + match[0].lastIndexOf(raw);
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "typst",
      file,
      starts,
      "asset",
      raw,
      nameOffset,
      nameOffset + raw.length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }

  const explicitReference =
    /#(?:ref|link)\s*\(\s*<([A-Za-z_][A-Za-z0-9_:-]*)>/g;
  for (const match of masked.matchAll(explicitReference)) {
    const nameOffset = match.index + match[0].lastIndexOf(match[1]);
    addUse(
      uses,
      "typst",
      file,
      starts,
      "reference",
      match[1],
      nameOffset,
      nameOffset + match[1].length,
    );
  }

  const explicitCitation =
    /#cite\s*\(\s*(?:label\s*\(\s*)?"?([A-Za-z_][A-Za-z0-9_:.#$%&+?~/-]*)"?/g;
  for (const match of masked.matchAll(explicitCitation)) {
    const nameOffset = match.index + match[0].lastIndexOf(match[1]);
    addUse(
      uses,
      "typst",
      file,
      starts,
      "citation",
      match[1],
      nameOffset,
      nameOffset + match[1].length,
    );
  }
}

export function analyzeProjectFile(
  file: string,
  source: string,
  sourceRevision: number,
): FileIntelligence {
  const engine = engineForPath(file);
  if (!engine) {
    throw new Error(`Unsupported project-intelligence file: ${file}`);
  }
  if (engine === "bibtex") {
    return parseBibtexIntelligence(file, source, sourceRevision);
  }

  const starts = lineStarts(source);
  const legacy = parseFile(file, source);
  const definitions: ProjectDefinition[] = [];
  const uses: ProjectUse[] = [];
  const edges: ProjectEdge[] = [];
  const diagnostics: ProjectDiagnostic[] = [];
  const fullRanges = new Map<string, SourceRange>();

  for (const symbol of legacy.defs) {
    if (
      engine === "typst" &&
      symbol.kind === "label" &&
      /#(?:ref|link)\s*\([^)]*$/.test(
        source.slice(Math.max(0, symbol.from - 80), symbol.from),
      )
    ) {
      continue;
    }
    const kind = definitionKind(symbol);
    if (!kind) continue;
    const definition = addDefinition(
      definitions,
      engine,
      file,
      starts,
      kind,
      symbol.name,
      symbol.nameFrom,
      symbol.nameTo,
      undefined,
      symbol.level,
    );
    fullRanges.set(
      definition.id,
      rangeFromOffsets(starts, symbol.from, symbol.to),
    );
  }
  for (const symbol of legacy.uses) {
    const kind = projectUseKind(symbol, source);
    if (!kind) continue;
    const target =
      symbol.kind === "inputedge" && engine === "latex"
        ? resolveProjectPath(file, symbol.name) ?? undefined
        : symbol.target;
    const use = addUse(
      uses,
      engine,
      file,
      starts,
      kind,
      symbol.name,
      symbol.nameFrom,
      symbol.nameTo,
      target,
      symbol.kind === "atuse" && engine === "typst"
        ? "typst-at"
        : "explicit",
    );
    if (
      kind === "include" ||
      kind === "import" ||
      kind === "link" ||
      kind === "asset" ||
      kind === "bibliography"
    ) {
      edges.push(edgeForUse(use, target ?? null));
    }
  }

  let partial = false;
  if (engine === "latex") {
    const masked = maskLatexComments(source);
    latexAdditionalSyntax(
      file,
      masked,
      starts,
      definitions,
      uses,
      edges,
    );
    partial =
      addDelimiterDiagnostics(
        file,
        source,
        masked,
        starts,
        engine,
        diagnostics,
      ) ||
      latexEnvironmentDiagnostics(
        file,
        masked,
        starts,
        diagnostics,
      );
  } else if (engine === "markdown") {
    partial = markdownAdditionalSyntax(
      file,
      source,
      starts,
      definitions,
      uses,
      edges,
      diagnostics,
    );
  } else {
    const masked = maskTypstComments(source);
    typstAdditionalSyntax(
      file,
      masked,
      starts,
      definitions,
      uses,
      edges,
    );
    partial = addDelimiterDiagnostics(
      file,
      source,
      masked,
      starts,
      engine,
      diagnostics,
    );
  }

  const uniqueDefinitions = uniqueById(definitions);
  const uniqueUses = uniqueById(uses);
  const uniqueEdges = uniqueById(edges);
  return {
    file,
    engine,
    sourceRevision,
    contentHash: sourceHash(source),
    status: partial ? "partial" : "success",
    ...(partial
      ? {
          statusReason:
            "Recovery retained structure around malformed source.",
        }
      : {}),
    outline: outlineForDefinitions(
      file,
      uniqueDefinitions,
      fullRanges,
    ),
    definitions: uniqueDefinitions,
    uses: uniqueUses,
    edges: uniqueEdges,
    diagnostics,
    bibliographyEntries: [],
  };
}
