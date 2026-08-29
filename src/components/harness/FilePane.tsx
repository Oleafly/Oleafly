import { SquareArrowOutUpRight } from "lucide-react";
import { useFilesStore } from "@/store/files";
import { FileViewerPane } from "./FileViewerPane";
import { PdfFilePane } from "./PdfFilePane";

// One open file as a panel tab: breadcrumb header (with the explicit
// workspace-editor launch) above a PDF or text view. Closing happens through
// the tab strip, not in here.
export function FilePane({ path }: { path: string }) {
  const openFile = useFilesStore((s) => s.openFile);
  const segments = path.split("/");
  const fileName = segments.pop() ?? path;
  const isPdf = path.toLowerCase().endsWith(".pdf");

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="harness-file-pane">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <span
          className="truncate font-mono"
          data-testid="harness-file-viewer-path"
          title={path}
        >
          {segments.length > 0 && (
            <span className="text-muted-foreground/70">{segments.join(" / ")} / </span>
          )}
          <span className="text-foreground">{fileName}</span>
        </span>
        <button
          type="button"
          data-testid="harness-file-open-in-editor"
          onClick={() => void openFile(path)}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-accent hover:text-foreground"
          title="Open this file in the workspace editor"
        >
          <SquareArrowOutUpRight className="size-3" />
          Open
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {isPdf ? <PdfFilePane path={path} /> : <FileViewerPane path={path} />}
      </div>
    </div>
  );
}
