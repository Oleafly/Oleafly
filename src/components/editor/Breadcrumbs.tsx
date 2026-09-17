import { Fragment, memo, useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, FileText } from "lucide-react";
import { sectionCrumbsForState, type SectionCrumb } from "./breadcrumbs-source";
import {
  editorCursorRevision,
  noteEditorDocument,
  subscribeEditorCursor,
} from "./cm/cursor-signal";
import { getEditorView, gotoRange } from "./cm/controller";
import { useFilesStore } from "@/store/files";

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function currentCrumbs(visual: boolean): SectionCrumb[] {
  const view = getEditorView();
  if (!view) return [];
  return sectionCrumbsForState(view.state, visual);
}

function BreadcrumbsBar({ visual = false }: Readonly<{ visual?: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  const activePath = useFilesStore((s) => s.activePath);
  const docVersion = useFilesStore((s) => s.docVersion);
  useSyncExternalStore(
    subscribeEditorCursor,
    editorCursorRevision,
    editorCursorRevision,
  );
  useEffect(() => {
    noteEditorDocument(activePath, docVersion);
  }, [activePath, docVersion]);
  if (!activePath) return null;
  const crumbs = currentCrumbs(visual);

  return (
    <nav
      data-testid="editor-breadcrumbs"
      aria-label={t(($) => $.editor.breadcrumbs.label)}
      className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b px-3 text-xs text-muted-foreground no-scrollbar"
    >
      <FileText className="size-3.5 shrink-0" aria-hidden />
      <span className="shrink-0 whitespace-nowrap">{basename(activePath)}</span>
      {crumbs.map((crumb) => (
        <Fragment key={`${crumb.line}:${crumb.pos}`}>
          <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />
          <button
            type="button"
            title={t(($) => $.editor.breadcrumbs.goTo, { title: crumb.title })}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => gotoRange(crumb.pos, crumb.pos)}
            className="shrink-0 whitespace-nowrap rounded px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
          >
            {crumb.title === "" ? t(($) => $.editor.breadcrumbs.untitled) : crumb.title}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}

export const Breadcrumbs = memo(BreadcrumbsBar);
