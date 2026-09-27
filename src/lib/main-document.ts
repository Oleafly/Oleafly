import type { FileEntry, ManifestHome } from "@oleafly/backend-port";
import { i18n } from "@/i18n";
import type { DetectionCandidate, DetectionReason, DocumentKind } from "@/lib/folder-detection";

export const ALL_MAIN_EXTENSIONS: readonly string[] = ["tex", "ltx", "latex", "typ", "md", "markdown"];

const REASON_ORDER: readonly DetectionReason[] = [
  "declared",
  "named_main",
  "named_after_folder",
  "top_level",
  "includes_files",
  "has_bibliography",
  "standalone_figure",
  "no_begin_document",
  "placeholder",
];

export interface MainDocumentView {
  projectId: string | null;
  manifestHome: ManifestHome;
  tree: readonly FileEntry[];
  mainDoc: string;
}

const LINKED_HOMES: ReadonlySet<ManifestHome> = new Set(["folder", "device", "device_foreign"]);

export function isLinkedHome(home: ManifestHome): boolean {
  return LINKED_HOMES.has(home);
}

function foldedPath(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

interface TreeFiles {
  exact: ReadonlySet<string>;
  folded: ReadonlySet<string>;
}

const treeFiles = new WeakMap<readonly FileEntry[], TreeFiles>();

function filesOf(tree: readonly FileEntry[]): TreeFiles {
  const known = treeFiles.get(tree);
  if (known) return known;
  const exact = new Set<string>();
  const folded = new Set<string>();
  for (const entry of tree) {
    if (entry.is_dir) continue;
    exact.add(entry.path);
    folded.add(foldedPath(entry.path));
  }
  const files = { exact, folded };
  treeFiles.set(tree, files);
  return files;
}

export function mainDocumentMissing(state: MainDocumentView): boolean {
  if (state.projectId === null || !isLinkedHome(state.manifestHome)) return false;
  const files = filesOf(state.tree);
  return !files.exact.has(state.mainDoc) && !files.folded.has(foldedPath(state.mainDoc));
}

export function documentKindLabel(kind: DocumentKind): string {
  switch (kind) {
    case "document":
      return i18n.t(($) => $.shell.openedFolder.kind.document);
    case "book":
      return i18n.t(($) => $.shell.openedFolder.kind.book);
    case "presentation":
      return i18n.t(($) => $.shell.openedFolder.kind.presentation);
    case "poster":
      return i18n.t(($) => $.shell.openedFolder.kind.poster);
    case "standalone":
      return i18n.t(($) => $.shell.openedFolder.kind.standalone);
    case "typst":
      return i18n.t(($) => $.shell.openedFolder.kind.typst);
    case "markdown":
      return i18n.t(($) => $.shell.openedFolder.kind.markdown);
    default:
      return i18n.t(($) => $.shell.openedFolder.kind.unknown);
  }
}

function reasonLabel(reason: DetectionReason): string {
  switch (reason) {
    case "declared":
      return i18n.t(($) => $.shell.openedFolder.reason.declared);
    case "named_main":
      return i18n.t(($) => $.shell.openedFolder.reason.named_main);
    case "named_after_folder":
      return i18n.t(($) => $.shell.openedFolder.reason.named_after_folder);
    case "top_level":
      return i18n.t(($) => $.shell.openedFolder.reason.top_level);
    case "includes_files":
      return i18n.t(($) => $.shell.openedFolder.reason.includes_files);
    case "has_bibliography":
      return i18n.t(($) => $.shell.openedFolder.reason.has_bibliography);
    case "standalone_figure":
      return i18n.t(($) => $.shell.openedFolder.reason.standalone_figure);
    case "no_begin_document":
      return i18n.t(($) => $.shell.openedFolder.reason.no_begin_document);
    default:
      return i18n.t(($) => $.shell.openedFolder.reason.placeholder);
  }
}

export function candidateReasonLine(candidate: DetectionCandidate): string {
  return REASON_ORDER.filter((reason) => candidate.reasons.includes(reason))
    .map(reasonLabel)
    .join(" · ");
}
