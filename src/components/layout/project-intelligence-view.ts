import type {
  BibliographyEntry,
  OutlineNode,
  ProjectDefinition,
  ProjectDiagnostic,
  ProjectEdge,
  ProjectHierarchyNode,
  ProjectIntelligenceSnapshot,
  ProjectUse,
  SourceLocation,
} from "@/lib/project-intelligence/types";
import type {
  IntelligenceNodeKind,
  IntelligenceNodeTone,
  IntelligenceTreeNode,
} from "@/components/layout/IntelligenceTree";

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function locationTarget(location: SourceLocation) {
  return {
    path: location.file,
    from: location.range.from,
    to: location.range.to,
  };
}

function rangeTarget(file: string, range: { from: number; to: number }) {
  return { path: file, from: range.from, to: range.to };
}

function provenance(location: SourceLocation): string {
  return `${basename(location.file)}:${location.range.startLine}:${location.range.startColumn + 1}`;
}

function kindLabel(kind: string): string {
  return kind.replaceAll("-", " ");
}

function outlineKind(kind: OutlineNode["kind"]): IntelligenceNodeKind {
  return kind === "anchor" ? "label" : kind;
}

function projectUseKind(kind: ProjectUse["kind"]): IntelligenceNodeKind {
  switch (kind) {
    case "citation":
      return "citation";
    case "include":
    case "import":
      return "include";
    case "macro":
      return "macro";
    case "environment":
      return "environment";
    default:
      return "reference";
  }
}

function definitionKind(
  kind: ProjectDefinition["kind"],
): IntelligenceNodeKind {
  if (kind === "anchor") return "label";
  return kind;
}

function resolutionTone(
  resolution: ProjectUse["resolution"] | ProjectEdge["resolution"],
): IntelligenceNodeTone {
  if (resolution === "unresolved") return "danger";
  if (resolution === "duplicate") return "warning";
  if (resolution === "external") return "muted";
  return "default";
}

function resolutionBadge(
  resolution: ProjectUse["resolution"] | ProjectEdge["resolution"],
): string | undefined {
  if (resolution === "unresolved") return "missing";
  if (resolution === "duplicate") return "ambiguous";
  if (resolution === "external") return "external";
  return undefined;
}

interface MutableOutlineTreeNode {
  item: OutlineNode;
  children: MutableOutlineTreeNode[];
}

function nestOutline(items: readonly OutlineNode[]): MutableOutlineTreeNode[] {
  const byId = new Map<string, MutableOutlineTreeNode>();
  const roots: MutableOutlineTreeNode[] = [];

  for (const item of items) {
    byId.set(item.id, { item, children: [] });
  }

  for (const item of items) {
    const node = byId.get(item.id);
    if (!node) continue;
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (nodes: MutableOutlineTreeNode[]) => {
    nodes.sort((left, right) => left.item.range.from - right.item.range.from);
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

function presentOutlineNode(
  node: MutableOutlineTreeNode,
  idPrefix: string,
): IntelligenceTreeNode {
  return {
    id: `${idPrefix}:outline:${node.item.id}`,
    label: node.item.title,
    kind: outlineKind(node.item.kind),
    description: `${kindLabel(node.item.kind)} in ${node.item.file}`,
    provenance: `${basename(node.item.file)}:${node.item.range.startLine}:${node.item.range.startColumn + 1}`,
    searchText: `${node.item.file} ${node.item.kind}`,
    defaultExpanded: node.item.kind === "file" || node.item.kind === "section",
    target: rangeTarget(node.item.file, node.item.range),
    children: node.children.map((child) =>
      presentOutlineNode(child, idPrefix),
    ),
  };
}

function presentEdge(
  edge: ProjectEdge,
  idPrefix: string,
): IntelligenceTreeNode {
  return {
    id: `${idPrefix}:edge:${edge.id}`,
    label: edge.rawTarget,
    kind: edge.kind === "include" || edge.kind === "import" ? "include" : "reference",
    description: `${kindLabel(edge.kind)} from ${edge.fromFile}`,
    provenance: provenance(edge.location),
    badge: resolutionBadge(edge.resolution),
    tone: resolutionTone(edge.resolution),
    searchText: `${edge.fromFile} ${edge.targetFile ?? ""} ${edge.kind}`,
    target: locationTarget(edge.location),
  };
}

function fileNodeForProject(
  context: {
    snapshot: ProjectIntelligenceSnapshot;
    nodesByFile: ReadonlyMap<string, ProjectHierarchyNode>;
    outgoingByFile: ReadonlyMap<string, readonly ProjectEdge[]>;
    rendered: number;
  },
  file: string,
  occurrenceId: string,
  ancestry: ReadonlySet<string>,
): IntelligenceTreeNode {
  context.rendered += 1;
  const { snapshot } = context;
  const hierarchyNode = context.nodesByFile.get(file);
  const fileData = snapshot.files[file];
  const nextAncestry = new Set(ancestry).add(file);
  const outlineChildren = nestOutline(snapshot.outlines[file] ?? []).map(
    (node) => presentOutlineNode(node, `${occurrenceId}:${file}`),
  );
  const outgoing = context.outgoingByFile.get(file) ?? [];

  const dependencyChildren = outgoing.map((edge) => {
    const edgeNode = presentEdge(edge, `${occurrenceId}:${file}`);
    const target = edge.targetFile;
    if (!target || ancestry.has(target) || target === file) {
      return {
        ...edgeNode,
        badge:
          target && (ancestry.has(target) || target === file)
            ? "cycle"
            : edgeNode.badge,
      };
    }
    if (context.rendered >= 5_000 || ancestry.size >= 32) {
      return {
        ...edgeNode,
        badge: "folded",
        tone: "warning" as const,
        children: [
          {
            id: `${occurrenceId}:${file}:edge:${edge.id}:render-limit`,
            label: "Open the linked source to continue",
            kind: "warning" as const,
            description:
              "This branch is folded to keep very large project graphs responsive.",
            tone: "warning" as const,
          },
        ],
      };
    }
    return {
      ...edgeNode,
      defaultExpanded: edge.kind === "include" || edge.kind === "import",
      children: [
        fileNodeForProject(
          context,
          target,
          `${occurrenceId}:via:${edge.id}`,
          nextAncestry,
        ),
      ],
    };
  });

  const children = [...outlineChildren];
  if (dependencyChildren.length) {
    children.push({
      id: `${occurrenceId}:${file}:dependencies`,
      label: "Links & dependencies",
      kind: "group",
      badge: String(dependencyChildren.length),
      defaultExpanded: true,
      children: dependencyChildren,
    });
  }

  const status = hierarchyNode?.status ?? fileData?.status ?? "error";
  const statusTone: IntelligenceNodeTone =
    status === "unreadable" || status === "error"
      ? "danger"
      : status === "partial"
        ? "warning"
        : "default";
  const line = hierarchyNode?.range.startLine ?? 1;
  const column = hierarchyNode?.range.startColumn ?? 0;
  const range = hierarchyNode?.range ?? {
    from: 0,
    to: 0,
  };

  return {
    id: `${occurrenceId}:file:${file}`,
    label: basename(file),
    kind: "file",
    description: file,
    provenance: `${basename(file)}:${line}:${column + 1}`,
    badge: status === "available" || status === "success" ? undefined : status,
    tone: statusTone,
    searchText: file,
    defaultExpanded: ancestry.size === 0,
    target: rangeTarget(file, range),
    children,
  };
}

export function buildProjectStructureNodes(
  snapshot: ProjectIntelligenceSnapshot,
): readonly IntelligenceTreeNode[] {
  const roots = snapshot.hierarchy.roots;
  const rootFiles = new Set(roots);
  const referencedFiles = new Set(
    snapshot.hierarchy.edges.flatMap((edge) =>
      edge.targetFile ? [edge.targetFile] : [],
    ),
  );
  const disconnected = snapshot.hierarchy.nodes
    .map((node) => node.file)
    .filter((file) => !rootFiles.has(file) && !referencedFiles.has(file))
    .sort((left, right) => left.localeCompare(right));

  const nodesByFile = new Map(
    snapshot.hierarchy.nodes.map((node) => [node.file, node]),
  );
  const outgoingByFile = new Map<string, ProjectEdge[]>();
  for (const edge of snapshot.hierarchy.edges) {
    const existing = outgoingByFile.get(edge.fromFile);
    if (existing) existing.push(edge);
    else outgoingByFile.set(edge.fromFile, [edge]);
  }
  for (const edges of outgoingByFile.values()) {
    edges.sort(
      (left, right) =>
        left.location.range.from - right.location.range.from,
    );
  }
  const context = {
    snapshot,
    nodesByFile,
    outgoingByFile,
    rendered: 0,
  };

  const nodes: IntelligenceTreeNode[] = roots.map((file) =>
    fileNodeForProject(
      context,
      file,
      `project:root:${file}`,
      new Set(),
    ),
  );
  if (disconnected.length) {
    nodes.push({
      id: "project:unlinked",
      label: "Unlinked files",
      kind: "group",
      badge: String(disconnected.length),
      defaultExpanded: false,
      children: disconnected.map((file) =>
        fileNodeForProject(
          context,
          file,
          `project:unlinked:${file}`,
          new Set(),
        ),
      ),
    });
  }
  return nodes;
}

function bibliographyMetadata(entry: BibliographyEntry): {
  description: string;
  badge: string;
} {
  const fields = new Map(
    entry.fields.map((field) => [field.name.toLocaleLowerCase(), field.value]),
  );
  const author = fields.get("author");
  const title = fields.get("title");
  const year = fields.get("year");
  const description = [title, author].filter(Boolean).join(", ");
  return {
    description: description || `${entry.type} entry in ${entry.file}`,
    badge: year || entry.type,
  };
}

function presentUse(
  use: ProjectUse,
  idPrefix: string,
): IntelligenceTreeNode {
  return {
    id: `${idPrefix}:use:${use.id}`,
    label: use.name,
    kind: projectUseKind(use.kind),
    description: `${kindLabel(use.kind)} in ${use.location.file}`,
    provenance: provenance(use.location),
    badge: resolutionBadge(use.resolution),
    tone: resolutionTone(use.resolution),
    searchText: `${use.location.file} ${use.kind} ${use.target ?? ""}`,
    target: locationTarget(use.location),
  };
}

function groupUsesByFile(
  uses: readonly ProjectUse[],
  idPrefix: string,
): readonly IntelligenceTreeNode[] {
  const groups = new Map<string, ProjectUse[]>();
  for (const use of uses) {
    const existing = groups.get(use.location.file);
    if (existing) existing.push(use);
    else groups.set(use.location.file, [use]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, fileUses]) => ({
      id: `${idPrefix}:file:${file}`,
      label: basename(file),
      kind: "file" as const,
      description: file,
      badge: String(fileUses.length),
      defaultExpanded: true,
      searchText: file,
      children: [...fileUses]
        .sort(
          (left, right) =>
            left.location.range.from - right.location.range.from,
        )
        .map((use) => presentUse(use, `${idPrefix}:${file}`)),
    }));
}

export function buildCitationNodes(
  snapshot: ProjectIntelligenceSnapshot,
): readonly IntelligenceTreeNode[] {
  const citations = snapshot.uses.filter((use) => use.kind === "citation");
  const unresolved = citations.filter(
    (use) => use.resolution === "unresolved",
  );
  const duplicateUses = citations.filter(
    (use) => use.resolution === "duplicate",
  );
  const nodes: IntelligenceTreeNode[] = [];

  if (unresolved.length) {
    nodes.push({
      id: "citations:unresolved",
      label: "Unresolved citations",
      kind: "warning",
      badge: String(unresolved.length),
      tone: "danger",
      defaultExpanded: true,
      children: groupUsesByFile(unresolved, "citations:unresolved"),
    });
  }

  if (snapshot.bibliography.duplicates.length || duplicateUses.length) {
    const duplicateKeys = snapshot.bibliography.duplicates.map((duplicate) => ({
      id: `citations:duplicate:${duplicate.key}`,
      label: duplicate.key,
      kind: "bibentry" as const,
      badge: `${duplicate.locations.length} definitions`,
      tone: "warning" as const,
      defaultExpanded: true,
      searchText: duplicate.locations.map((item) => item.file).join(" "),
      children: duplicate.locations.map((location) => ({
        id: `citations:duplicate:${duplicate.key}:${location.file}:${location.range.from}:${location.range.to}`,
        label: basename(location.file),
        kind: "bibentry" as const,
        provenance: provenance(location),
        description: `Duplicate key ${duplicate.key} in ${location.file}`,
        target: locationTarget(location),
      })),
    }));
    nodes.push({
      id: "citations:duplicates",
      label: "Duplicate citation keys",
      kind: "warning",
      badge: String(
        Math.max(snapshot.bibliography.duplicates.length, duplicateUses.length),
      ),
      tone: "warning",
      defaultExpanded: true,
      children: [
        ...duplicateKeys,
        ...groupUsesByFile(duplicateUses, "citations:ambiguous"),
      ],
    });
  }

  const entriesByFile = new Map<string, BibliographyEntry[]>();
  const citationsByKey = new Map<string, ProjectUse[]>();
  for (const citation of citations) {
    const existing = citationsByKey.get(citation.name);
    if (existing) existing.push(citation);
    else citationsByKey.set(citation.name, [citation]);
  }
  for (const entry of snapshot.bibliography.entries) {
    const existing = entriesByFile.get(entry.file);
    if (existing) existing.push(entry);
    else entriesByFile.set(entry.file, [entry]);
  }
  const entryFiles = [...entriesByFile.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, entries]) => ({
      id: `citations:bibliography:file:${file}`,
      label: basename(file),
      kind: "file" as const,
      description: file,
      badge: String(entries.length),
      defaultExpanded: true,
      searchText: file,
      children: entries.map((entry) => {
        const metadata = bibliographyMetadata(entry);
        const entryCitations = citationsByKey.get(entry.key) ?? [];
        return {
          id: `citations:entry:${entry.id}`,
          label: entry.key,
          kind: "bibentry" as const,
          description: [
            entry.duplicate ? "Duplicate key." : "",
            entry.complete ? "" : "Incomplete entry.",
            metadata.description,
          ]
            .filter(Boolean)
            .join(" "),
          provenance: `${basename(entry.file)}:${entry.range.startLine}:${entry.range.startColumn + 1}`,
          badge: entry.duplicate
            ? `${entry.duplicateIndex + 1}/${entry.duplicateCount}`
            : entry.complete
              ? metadata.badge
              : "incomplete",
          tone: entry.duplicate
            ? ("warning" as const)
            : entry.complete
              ? ("default" as const)
              : ("warning" as const),
          searchText: `${entry.file} ${entry.type} ${entry.fields
            .map((field) => field.value)
            .join(" ")}`,
          target: rangeTarget(entry.file, entry.keyRange),
          defaultExpanded: false,
          children: entryCitations.length
            ? groupUsesByFile(
                entryCitations,
                `citations:entry:${entry.id}:uses`,
              )
            : undefined,
        };
      }),
    }));

  if (entryFiles.length) {
    nodes.push({
      id: "citations:bibliography",
      label: "Bibliography",
      kind: "group",
      badge: String(snapshot.bibliography.entries.length),
      defaultExpanded: true,
      children: entryFiles,
    });
  }

  return nodes;
}

function presentDefinition(
  definition: ProjectDefinition,
  idPrefix: string,
  duplicate: boolean,
): IntelligenceTreeNode {
  return {
    id: `${idPrefix}:definition:${definition.id}`,
    label: definition.name,
    kind: definitionKind(definition.kind),
    description:
      definition.detail ??
      `${kindLabel(definition.kind)} in ${definition.location.file}`,
    provenance: provenance(definition.location),
    badge: duplicate ? "duplicate" : undefined,
    tone: duplicate ? "warning" : "default",
    searchText: `${definition.location.file} ${definition.kind} ${definition.detail ?? ""}`,
    target: locationTarget(definition.location),
  };
}

function diagnosticNode(
  diagnostic: ProjectDiagnostic,
  idPrefix: string,
): IntelligenceTreeNode {
  const tone: IntelligenceNodeTone =
    diagnostic.severity === "error" ? "danger" : "warning";
  return {
    id: `${idPrefix}:diagnostic:${diagnostic.id}`,
    label: diagnostic.message,
    kind: "warning",
    description: `${diagnostic.code} in ${diagnostic.location.file}`,
    provenance: provenance(diagnostic.location),
    tone,
    searchText: `${diagnostic.location.file} ${diagnostic.code}`,
    target: locationTarget(diagnostic.location),
    defaultExpanded: true,
    children: diagnostic.related.map((related) => ({
      id: `${idPrefix}:diagnostic:${diagnostic.id}:related:${related.location.file}:${related.location.range.from}:${related.location.range.to}`,
      label: related.message,
      kind: "reference",
      description: related.location.file,
      provenance: provenance(related.location),
      target: locationTarget(related.location),
    })),
  };
}

export function buildSymbolNodes(
  snapshot: ProjectIntelligenceSnapshot,
): readonly IntelligenceTreeNode[] {
  const nodes: IntelligenceTreeNode[] = [];
  const referenceIssues = snapshot.uses.filter(
    (use) =>
      use.kind !== "citation" &&
      (use.resolution === "unresolved" || use.resolution === "duplicate"),
  );
  const definitionDiagnostics = snapshot.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === "duplicate-definition" ||
      diagnostic.code === "unresolved-reference" ||
      diagnostic.code === "unresolved-target",
  );

  if (referenceIssues.length || definitionDiagnostics.length) {
    nodes.push({
      id: "symbols:issues",
      label: "Unresolved & duplicate",
      kind: "warning",
      badge: String(referenceIssues.length + definitionDiagnostics.length),
      tone: referenceIssues.some((use) => use.resolution === "unresolved")
        ? "danger"
        : "warning",
      defaultExpanded: true,
      children: [
        ...groupUsesByFile(referenceIssues, "symbols:issues"),
        ...definitionDiagnostics.map((diagnostic) =>
          diagnosticNode(diagnostic, "symbols:issues"),
        ),
      ],
    });
  }

  const duplicateDefinitionKeys = new Set<string>();
  const definitionCounts = new Map<string, number>();
  for (const definition of snapshot.definitions) {
    const key = `${definition.kind}\0${definition.name}`;
    definitionCounts.set(key, (definitionCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of definitionCounts) {
    if (count > 1) duplicateDefinitionKeys.add(key);
  }

  const groups: readonly {
    id: string;
    label: string;
    kinds: readonly ProjectDefinition["kind"][];
  }[] = [
    { id: "sections", label: "Sections", kinds: ["section"] },
    { id: "labels", label: "Labels & anchors", kinds: ["label", "anchor"] },
    { id: "macros", label: "Commands", kinds: ["macro"] },
    { id: "environments", label: "Environments", kinds: ["environment"] },
    { id: "bibliography", label: "BibTeX entries", kinds: ["bibentry"] },
  ];

  for (const group of groups) {
    const definitions = snapshot.definitions
      .filter((definition) => group.kinds.includes(definition.kind))
      .sort(
        (left, right) =>
          left.location.file.localeCompare(right.location.file) ||
          left.location.range.from - right.location.range.from,
      );
    if (!definitions.length) continue;
    nodes.push({
      id: `symbols:${group.id}`,
      label: group.label,
      kind: "group",
      badge: String(definitions.length),
      defaultExpanded: group.id !== "sections",
      children: definitions.map((definition) =>
        presentDefinition(
          definition,
          `symbols:${group.id}`,
          duplicateDefinitionKeys.has(
            `${definition.kind}\0${definition.name}`,
          ),
        ),
      ),
    });
  }

  return nodes;
}

export function buildReferenceResultNodes(
  definitions: readonly ProjectDefinition[],
  uses: readonly ProjectUse[],
): readonly IntelligenceTreeNode[] {
  const nodes: IntelligenceTreeNode[] = [];
  if (definitions.length) {
    nodes.push({
      id: "query:definitions",
      label: definitions.length === 1 ? "Definition" : "Definitions",
      kind: "group",
      badge: String(definitions.length),
      defaultExpanded: true,
      children: definitions.map((definition) =>
        presentDefinition(
          definition,
          "query:definitions",
          definitions.length > 1,
        ),
      ),
    });
  }
  if (uses.length) {
    nodes.push({
      id: "query:references",
      label: "Occurrences",
      kind: "group",
      badge: String(uses.length),
      defaultExpanded: true,
      children: groupUsesByFile(uses, "query:references"),
    });
  }
  return nodes;
}

export function projectIssueCount(
  snapshot: ProjectIntelligenceSnapshot,
): number {
  return snapshot.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === "duplicate-definition" ||
      diagnostic.code === "duplicate-citation-key" ||
      diagnostic.code === "unresolved-reference" ||
      diagnostic.code === "unresolved-citation" ||
      diagnostic.code === "unresolved-target" ||
      diagnostic.code === "malformed-bibtex" ||
      diagnostic.code === "unreadable-file",
  ).length;
}
