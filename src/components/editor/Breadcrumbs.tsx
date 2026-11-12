import { Fragment, memo, useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Tooltip } from "@/components/ui/tooltip";
import { sectionCrumbsForState, type SectionCrumb } from "./breadcrumbs-source";
import {
  editorCursorRevision,
  noteEditorDocument,
  subscribeEditorCursor,
} from "./cm/cursor-signal";
import { getEditorView, gotoRange } from "./cm/controller";
import { useFilesStore } from "@/store/files";
import { basename } from "@/lib/path-utils";

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
    <Breadcrumb
      data-testid="editor-breadcrumbs"
      aria-label={t(($) => $.editor.breadcrumbs.label)}
      className="flex h-7 shrink-0 items-center overflow-x-auto border-b px-3 no-scrollbar"
    >
      <BreadcrumbList className="shrink-0 whitespace-nowrap text-xs">
        <BreadcrumbItem className="gap-1">
          <FileText className="size-3.5 shrink-0" aria-hidden />
          {basename(activePath)}
        </BreadcrumbItem>
        {crumbs.map((crumb) => {
          const title = crumb.title === "" ? t(($) => $.editor.breadcrumbs.untitled) : crumb.title;
          return (
            <Fragment key={`${crumb.line}:${crumb.pos}`}>
              <BreadcrumbSeparator className="opacity-60 [&>svg]:size-3" />
              <BreadcrumbItem>
                <Tooltip label={t(($) => $.editor.breadcrumbs.goTo, { title })}>
                  <BreadcrumbLink asChild>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => gotoRange(crumb.pos, crumb.pos)}
                    >
                      {title}
                    </button>
                  </BreadcrumbLink>
                </Tooltip>
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export const Breadcrumbs = memo(BreadcrumbsBar);
