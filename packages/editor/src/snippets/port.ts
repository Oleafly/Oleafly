import { type EditorState, Facet } from "@codemirror/state";
import type { ProjectFieldKind, SnippetLanguage, SnippetLibrary, SnippetRecord } from "@oleafly/snippets";

export interface SnippetSwitches {
  list: boolean;
  tab: boolean;
  auto: boolean;
  hint: boolean;
}

export interface SnippetProjectItem {
  label: string;
  detail?: string;
}

export interface SnippetPort {
  library(): SnippetLibrary;
  language(): SnippetLanguage | null;
  filePath(): string | null;
  projectName(): string | null;
  typstVersion(): [number, number] | undefined;
  enabled(): SnippetSwitches;
  projectItems(kind: ProjectFieldKind): readonly SnippetProjectItem[];
  useCount(id: string): number;
  recordUse(id: string): void;
  readClipboard(): Promise<string>;
  renderMathPreview?(source: string, language: SnippetLanguage): HTMLElement | null;
  editSnippet?(id: string): void;
  collectionName?(collection: string): string | null;
  fieldHintsLeft(): number;
  consumeFieldHint(): void;
  onAutoExpanded(record: SnippetRecord): void;
  onHandTypedFraction(): void;
  reportSlowRegex(record: SnippetRecord): void;
}

export const snippetPortFacet = Facet.define<SnippetPort | null, SnippetPort | null>({
  combine: (ports) => ports.find((port) => port !== null) ?? null,
});

export function snippetPort(state: EditorState): SnippetPort | null {
  return state.facet(snippetPortFacet);
}
