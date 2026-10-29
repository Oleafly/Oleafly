import { type EditorState, Facet } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { decodeTypstString } from "../../../typst-literals";
import {
  parseTypstPackageSpec,
  type TypstFormBinding,
  type TypstFormCatalog,
  type TypstFormDefinition,
} from "../../../typst-forms";
import { BUILTIN_DISPATCH_NAMES } from "../builtins";
import { expressionAfterHash } from "../syntax";

// The open file's project-relative path, which relative imports resolve against.
export const typstDocumentPath = Facet.define<string | null, string | null>({
  combine: (values) => values[0] ?? null,
});

export interface ImportItem {
  readonly path: readonly string[];
  readonly local: string;
}

export interface TypstImport {
  readonly to: number;
  // null when the source is an expression, or a path that leaves the project.
  readonly source: TypstFormBinding | null;
  readonly module: string | null;
  readonly items: readonly ImportItem[] | "all" | null;
}

export interface TypstLet {
  readonly to: number;
  readonly name: string;
}

export interface DocumentBindings {
  readonly imports: readonly TypstImport[];
  readonly lets: readonly TypstLet[];
  readonly packages: readonly string[];
}

function text(state: EditorState, node: { from: number; to: number }): string {
  return state.sliceDoc(node.from, node.to);
}

export function resolveImportPath(documentPath: string | null, importPath: string): string | null {
  if (importPath.includes("\\")) return null;
  const base = importPath.startsWith("/") ? [] : (documentPath ?? "").replaceAll("\\", "/").split("/").slice(0, -1);
  const segments = [...base];
  for (const segment of importPath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length > 0 ? segments.join("/") : null;
}

function importSource(spec: string, documentPath: string | null): { source: TypstFormBinding | null; stem: string } | null {
  const pkg = parseTypstPackageSpec(spec);
  if (pkg) return { source: { kind: "package", spec }, stem: pkg.name };
  if (spec.startsWith("@")) return null;
  const path = resolveImportPath(documentPath, spec);
  const stem = (spec.split("/").at(-1) ?? "").replace(/\.typ$/u, "");
  return { source: path ? { kind: "module", path } : null, stem };
}

function importItems(state: EditorState, statement: SyntaxNode): readonly ImportItem[] | "all" | null {
  if (statement.getChild("Star")) return "all";
  const list = statement.getChild("ImportItems");
  if (!list) return null;
  const items: ImportItem[] = [];
  for (let item = list.firstChild; item; item = item.nextSibling) {
    const pathNode = item.name === "RenamedImportItem" ? item.getChild("ImportItemPath") : item;
    if (pathNode?.name !== "ImportItemPath") continue;
    const path = pathNode.getChildren("Ident").map((ident) => text(state, ident));
    const renamed = item.name === "RenamedImportItem" ? item.getChild("Ident") : null;
    const local = renamed ? text(state, renamed) : path.at(-1);
    if (local) items.push({ path, local });
  }
  return items;
}

function readImport(state: EditorState, statement: SyntaxNode, documentPath: string | null): TypstImport {
  const items = importItems(state, statement);
  const head = statement.getChild("Import")?.nextSibling ?? null;
  const literal = head?.name === "Str" ? decodeTypstString(text(state, head)) : null;
  const origin = literal === null ? null : importSource(literal, documentPath);
  const alias = statement.getChild("As")?.nextSibling ?? null;
  const named = alias?.name === "Ident" ? text(state, alias) : null;
  const module = named ?? (items === null ? (origin?.stem ?? null) : null);
  return { to: statement.to, source: origin?.source ?? null, module: module || null, items };
}

function patternNames(state: EditorState, pattern: SyntaxNode): string[] {
  const names: string[] = [];
  for (let child = pattern.firstChild; child; child = child.nextSibling) {
    if (child.name === "Ident") names.push(text(state, child));
    else if (child.name === "Named" && child.lastChild && child.lastChild !== child.firstChild) {
      names.push(...(child.lastChild.name === "Ident" ? [text(state, child.lastChild)] : patternNames(state, child.lastChild)));
    } else names.push(...patternNames(state, child));
  }
  return names;
}

function letNames(state: EditorState, statement: SyntaxNode): string[] {
  const target = statement.getChild("Let")?.nextSibling ?? null;
  if (target?.name === "Ident") return [text(state, target)];
  if (target?.name === "Closure") {
    const name = target.firstChild;
    return name?.name === "Ident" ? [text(state, name)] : [];
  }
  return target?.name === "Destructuring" ? patternNames(state, target) : [];
}

const bindingsCache = new WeakMap<Tree, { path: string | null; bindings: DocumentBindings }>();

// The document's own top-level `#import` and `#let` statements, in document order.
export function documentBindings(state: EditorState, tree: Tree): DocumentBindings {
  const documentPath = state.facet(typstDocumentPath);
  const cached = bindingsCache.get(tree);
  if (cached?.path === documentPath) return cached.bindings;
  const imports: TypstImport[] = [];
  const lets: TypstLet[] = [];
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    if (child.name !== "Hash") continue;
    const statement = expressionAfterHash(child);
    if (statement?.name === "ModuleImport") imports.push(readImport(state, statement, documentPath));
    else if (statement?.name === "LetBinding") {
      for (const name of letNames(state, statement)) lets.push({ to: statement.to, name });
    }
  }
  const packages = [
    ...new Set(imports.flatMap((entry) => (entry.source?.kind === "package" ? [entry.source.spec] : []))),
  ];
  const bindings = { imports, lets, packages };
  bindingsCache.set(tree, { path: documentPath, bindings });
  return bindings;
}

export interface FormIndex {
  lookup(binding: TypstFormBinding, fn: string): TypstFormDefinition | null;
  functions(binding: TypstFormBinding): readonly string[];
}

function bindingKey(binding: TypstFormBinding): string {
  return binding.kind === "package" ? `pkg:${binding.spec}` : `mod:${binding.path}`;
}

const indexCache = new WeakMap<TypstFormCatalog, FormIndex>();

export function buildFormIndex(catalog: TypstFormCatalog): FormIndex {
  const cached = indexCache.get(catalog);
  if (cached) return cached;
  const byId = new Map<string, TypstFormDefinition>();
  const bySource = new Map<string, string[]>();
  for (const form of catalog.forms) {
    const key = bindingKey(form.binding);
    byId.set(`${key}#${form.function}`, form);
    bySource.set(key, [...(bySource.get(key) ?? []), form.function]);
  }
  const index: FormIndex = {
    lookup: (binding, fn) => byId.get(`${bindingKey(binding)}#${fn}`) ?? null,
    functions: (binding) => bySource.get(bindingKey(binding)) ?? [],
  };
  indexCache.set(catalog, index);
  return index;
}

type Binding =
  | { readonly to: number; readonly kind: "shadow" }
  | { readonly to: number; readonly kind: "module"; readonly source: TypstFormBinding | null }
  | { readonly to: number; readonly kind: "item"; readonly source: TypstFormBinding | null; readonly path: readonly string[] };

const scopeCache = new WeakMap<FormIndex, WeakMap<DocumentBindings, FormScope>>();

// The names an import brings in, each with the path to the item it names.
function importedItems(index: FormIndex, entry: TypstImport): readonly ImportItem[] {
  if (entry.items !== "all") return entry.items ?? [];
  const declared = entry.source ? index.functions(entry.source) : [];
  return declared.map((fn) => ({ local: fn, path: [fn] }));
}

// Every binding of each name, in document order.
function boundNames(index: FormIndex, bindings: DocumentBindings): Map<string, Binding[]> {
  const names = new Map<string, Binding[]>();
  const bind = (name: string, binding: Binding) => names.set(name, [...(names.get(name) ?? []), binding]);
  for (const entry of bindings.imports) {
    if (entry.module) bind(entry.module, { to: entry.to, kind: "module", source: entry.source });
    for (const item of importedItems(index, entry)) bind(item.local, { to: entry.to, kind: "item", source: entry.source, path: item.path });
  }
  for (const entry of bindings.lets) bind(entry.name, { to: entry.to, kind: "shadow" });
  for (const list of names.values()) list.sort((a, b) => a.to - b.to);
  return names;
}

// Resolves a `#`-call's callee to the form it reaches through the document's own bindings.
export class FormScope {
  private constructor(
    private readonly index: FormIndex,
    private readonly names: ReadonlyMap<string, readonly Binding[]>,
  ) {}

  static create(index: FormIndex, bindings: DocumentBindings): FormScope {
    let forIndex = scopeCache.get(index);
    if (!forIndex) {
      forIndex = new WeakMap();
      scopeCache.set(index, forIndex);
    }
    let scope = forIndex.get(bindings);
    if (!scope) {
      scope = new FormScope(index, boundNames(index, bindings));
      forIndex.set(bindings, scope);
    }
    return scope;
  }

  private active(name: string, at: number): Binding | null {
    const list = this.names.get(name);
    let found: Binding | null = null;
    for (const binding of list ?? []) {
      if (binding.to > at) break;
      found = binding;
    }
    return found;
  }

  resolve(callee: string, at: number): TypstFormDefinition | null {
    const parts = callee.split(".");
    if (parts.length > 2 || parts.includes("")) return null;
    if (parts.length === 1 && BUILTIN_DISPATCH_NAMES.has(callee)) return null;
    const binding = this.active(parts[0], at);
    if (!binding || binding.kind === "shadow" || !binding.source) return null;
    if (parts.length === 2) return binding.kind === "module" ? this.index.lookup(binding.source, parts[1]) : null;
    if (binding.kind !== "item" || binding.path.length !== 1) return null;
    return this.index.lookup(binding.source, binding.path[0]);
  }
}
