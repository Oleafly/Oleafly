import { pdfPointAt } from "@oleafly/preview";
import { inverseFromClick } from "@/features/synctex";
import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";

const PDF_SCROLLER = "[data-pdf-scroll-root]";
const MOVED_PAGES = 0.5;

interface PdfPlace {
  readonly projectId: string;
  readonly at: number;
}

type ViewFlags = Readonly<{ viewMode: string; workspaceHidden: boolean }>;

function editorShown({ viewMode, workspaceHidden }: ViewFlags): boolean {
  return !workspaceHidden && viewMode !== "pdf";
}

function shownPdf(projectId: string | null): DOMRect | null {
  if (projectId === null || usePreviewDetachedStore.getState().projectId === projectId) return null;
  const box = document.querySelector(PDF_SCROLLER)?.getBoundingClientRect();
  return box && box.width > 0 && box.height > 0 ? box : null;
}

function placeAtTop(box: DOMRect): number | null {
  const point = pdfPointAt(box.left + box.width / 2, box.top + 1);
  return point ? point.page + point.fraction : null;
}

export function startEditorFollowsPdf(): () => void {
  let place: PdfPlace | null = null;
  let project: string | null = null;
  let frame = 0;

  const cancel = () => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  };

  const remember = (projectId: string) => {
    const box = shownPdf(projectId);
    const at = box ? placeAtTop(box) : null;
    place = at === null ? null : { projectId, at };
    return at !== null;
  };

  const stop = useSettingsStore.subscribe((state, previous) => {
    const { projectId } = useFilesStore.getState();
    if (projectId !== project) {
      project = projectId;
      place = null;
      cancel();
      return;
    }
    const was = editorShown(previous);
    const now = editorShown(state);
    if (was === now) return;
    cancel();
    if (projectId === null) return;
    if (!now) {
      if (!remember(projectId)) {
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            frame = 0;
            remember(projectId);
          });
        });
      }
      return;
    }
    const before = place;
    place = null;
    const box = shownPdf(projectId);
    const at = box ? placeAtTop(box) : null;
    if (!box || at === null || before?.projectId !== projectId || Math.abs(at - before.at) < MOVED_PAGES) return;
    const center = pdfPointAt(box.left + box.width / 2, box.top + box.height / 2);
    if (center) void inverseFromClick(center.page, center.x, center.y);
  });

  return () => {
    cancel();
    stop();
  };
}
