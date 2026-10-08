import { bibKeyIndex, latexHasBibliography, latexUsesBiblatex } from "@/lib/zotero/bib-text";
import {
  findHandBibliographies,
  handBibEntries,
  handListDeclaration,
  replaceHandBibliography,
  type HandBibliography,
} from "@/lib/zotero/hand-bibliography";
import { useFilesStore } from "@/store/files";
import { useZoteroDialogStore } from "@/store/zotero-dialogs";

export interface HandListRequest {
  readonly file: string;
  readonly bib: string;
  readonly count: number;
}

export interface HandListMove {
  readonly file: string;
}

interface SourceText {
  readonly file: string;
  readonly content: string;
}

interface FoundList {
  readonly file: string;
  readonly content: string;
  readonly list: HandBibliography;
}

function singleHandList(sources: readonly SourceText[]): FoundList | null {
  if (sources.some((source) => latexHasBibliography(source.content) || latexUsesBiblatex(source.content))) return null;
  const lists = sources.flatMap((source) =>
    findHandBibliographies(source.content).map((list) => ({ file: source.file, content: source.content, list })),
  );
  if (lists.length !== 1) return null;
  const [found] = lists;
  return found.list.closed && found.list.convertible ? found : null;
}

export async function askHandListMove(request: {
  readonly sources: readonly SourceText[];
  readonly target: string;
  readonly confirm?: (request: HandListRequest) => Promise<boolean>;
}): Promise<HandListMove | "cancel" | null> {
  const files = useFilesStore.getState();
  if (files.engine.capabilities.formatting_profile !== "latex" || !/\.bib$/i.test(request.target)) return null;
  const found = singleHandList(request.sources);
  if (!found) return null;
  if (files.tree.some((entry) => entry.path === found.file && entry.read_only)) return null;
  const confirm = request.confirm ?? ((value: HandListRequest) => useZoteroDialogStore.getState().confirmHandList(value));
  const accepted = await confirm({ file: found.file, bib: request.target, count: found.list.items.length });
  return accepted ? { file: found.file } : "cancel";
}

export function handListEntries(
  move: HandListMove,
  input: { readonly sources: readonly SourceText[]; readonly bib: string; readonly adding: readonly string[] },
): string[] {
  const found = singleHandList(input.sources);
  if (!found || found.file !== move.file) return [];
  return handBibEntries(found.list.items, new Set([...bibKeyIndex(input.bib).keys, ...input.adding]));
}

export function handListText(move: HandListMove, sources: readonly SourceText[], bibliography: string): string | null {
  const found = singleHandList(sources);
  if (!found || found.file !== move.file) return null;
  const declaration = handListDeclaration(
    bibliography,
    sources.map((source) => source.content),
  );
  return replaceHandBibliography(found.content, found.list, declaration);
}
