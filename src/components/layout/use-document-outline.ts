import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  createLatexOutlineMacroCollector,
  createLatexWrapperSectionCollector,
  renderLatexOutlineTitle,
  type LatexWrapperSection,
} from "@oleafly/latex";
import { loadTypstParser, typstTools } from "@oleafly/editor/typst";
import { useEditorViewportSelection } from "@/components/editor/cm/use-viewport-anchor";
import { useTypstToc } from "@/features/typst-heading-numbers";
import { currentAuxToc, subscribeAuxNumbers, type AuxToc } from "@/lib/aux-numbers";
import { documentSourcePaths } from "@/lib/document-sources";
import {
  headingTitlesByLabel,
  outlineSources,
  outlineWalk,
  type OutlineItem,
  type OutlineWalk,
} from "@/lib/index/outline";
import {
  headingMarksOf,
  latexHeadingNumbers,
  typstHeadingNumbers,
  type HeadingMark,
  type HeadingNumbers,
  type LatexHeadingNumbersInput,
} from "@/lib/index/outline-numbers";
import type { ProjectIndex } from "@/lib/index/types";
import { activeOutlineIndex } from "@/lib/outline-active";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

type OutlineScope = "file" | "document";

export interface DocumentOutlineModel {
  readonly root: string | null;
  readonly items: readonly OutlineItem[];
  readonly marks: readonly (HeadingMark | null)[];
  readonly activeIndex: number;
  readonly title: (item: OutlineItem) => string;
}

const NO_WRAPPER_SECTIONS: ReadonlyMap<string, readonly LatexWrapperSection[]> = new Map();
const NO_LATEX_MACROS: ReadonlyMap<string, string> = new Map();
const NO_MARKS: readonly (HeadingMark | null)[] = [];
const NO_WALK: OutlineWalk = { items: [], trails: [] };
const TYPST_FILE = /\.typ$/iu;

let sharedNumbers: Readonly<{
  index: ProjectIndex;
  toc: AuxToc;
  texts: Readonly<Record<string, string>>;
  viewer: string;
  numbers: HeadingNumbers;
}> | null = null;

function documentNumbers(input: LatexHeadingNumbersInput): HeadingNumbers {
  const { index, toc, texts, viewer } = input;
  const last = sharedNumbers;
  if (last?.index === index && last.toc === toc && last.texts === texts && last.viewer === viewer) {
    return last.numbers;
  }
  const numbers = latexHeadingNumbers(input);
  sharedNumbers = { index, toc, texts, viewer, numbers };
  return numbers;
}

export function outlineRoot(
  scope: OutlineScope,
  index: ProjectIndex,
  activePath: string,
  mainDoc: string,
): string {
  if (scope === "file" || mainDoc === activePath) return activePath;
  return documentSourcePaths(index, mainDoc).includes(activePath) ? mainDoc : activePath;
}

export function jumpToOutlineItem(item: OutlineItem): void {
  void navigateToProjectRange({
    path: item.file,
    range: { from: item.from, to: item.to },
    source: "outline",
  });
}

function useTypstTitles(items: readonly OutlineItem[]): boolean {
  const wanted = items.some((item) => TYPST_FILE.test(item.file));
  const [ready, setReady] = useState(() => typstTools() !== null);
  useEffect(() => {
    if (!wanted || ready) return;
    let live = true;
    loadTypstParser().then(
      () => {
        if (live) setReady(true);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ready, wanted]);
  return ready;
}

function displayTitle(
  item: OutlineItem,
  latexMacros: ReadonlyMap<string, string>,
  headingsByLabel: ReadonlyMap<string, string>,
  typstTitles: boolean,
): string {
  if (/\.(?:latex|ltx|tex)$/iu.test(item.file)) {
    return renderLatexOutlineTitle(item.title, latexMacros, headingsByLabel);
  }
  if (typstTitles && TYPST_FILE.test(item.file)) {
    return typstTools()?.typstPlainTitle(item.title) ?? item.title;
  }
  return item.title;
}

export function useDocumentOutline(scope: OutlineScope, numbered: boolean): DocumentOutlineModel {
  const index = useIndexStore((state) => state.index);
  const projectId = useFilesStore((state) => state.projectId);
  const activePath = useFilesStore((state) => state.activePath);
  const mainDoc = useFilesStore(() => resolveEffectiveMainDoc().mainDoc);
  const root = useMemo(
    () => (index && activePath ? outlineRoot(scope, index, activePath, mainDoc) : null),
    [activePath, index, mainDoc, scope],
  );

  const macroSources = useMemo(
    () => (index ? outlineSources(useIndexStore.getState().texts, index, activePath) : null),
    [index, activePath],
  );
  const [collectWrapperSections] = useState(createLatexWrapperSectionCollector);
  const wrapperSections = useMemo(
    () => (macroSources ? collectWrapperSections(macroSources) : NO_WRAPPER_SECTIONS),
    [collectWrapperSections, macroSources],
  );
  const extraSections = useCallback(
    (file: string) => wrapperSections.get(file) ?? [],
    [wrapperSections],
  );
  const walk = useMemo(
    () => (index && root ? outlineWalk(index, root, extraSections) : NO_WALK),
    [extraSections, index, root],
  );
  const items = useMemo(() => walk.items.filter((item) => item.kind === "section"), [walk]);
  const headingsByLabel = useMemo(
    () => (index ? headingTitlesByLabel(index, extraSections, activePath ?? undefined) : new Map<string, string>()),
    [activePath, extraSections, index],
  );
  const [collectMacros] = useState(createLatexOutlineMacroCollector);
  const latexMacros = useMemo(
    () => (macroSources ? collectMacros(macroSources) : NO_LATEX_MACROS),
    [collectMacros, macroSources],
  );
  const typstTitles = useTypstTitles(items);
  const title = useCallback(
    (item: OutlineItem) => displayTitle(item, latexMacros, headingsByLabel, typstTitles),
    [headingsByLabel, latexMacros, typstTitles],
  );

  const auxToc = useSyncExternalStore(subscribeAuxNumbers, currentAuxToc);
  const typstToc = useTypstToc(numbered && root === mainDoc && TYPST_FILE.test(mainDoc));
  const marks = useMemo(() => {
    if (!numbered || !index || !activePath) return NO_MARKS;
    if (root === mainDoc && typstToc?.projectId === projectId && typstToc.mainDocument === mainDoc) {
      return headingMarksOf(items, typstHeadingNumbers(items, typstToc, title));
    }
    if (auxToc?.projectId !== projectId || auxToc.mainDocument !== mainDoc) return NO_MARKS;
    return headingMarksOf(
      items,
      documentNumbers({
        viewer: activePath,
        toc: auxToc,
        index,
        texts: useIndexStore.getState().texts,
        extraSections,
        render: (tex) => renderLatexOutlineTitle(tex, latexMacros, headingsByLabel),
        documentSections: root === mainDoc ? items : undefined,
      }),
    );
  }, [
    activePath,
    auxToc,
    extraSections,
    headingsByLabel,
    index,
    items,
    latexMacros,
    mainDoc,
    numbered,
    projectId,
    root,
    title,
    typstToc,
  ]);

  const reading = useEditorViewportSelection((anchor) => activeOutlineIndex(walk.items, anchor, walk.trails));
  const activeIndex = reading < 0 ? -1 : items.indexOf(walk.items[reading]);

  return { root, items, marks, activeIndex, title };
}
