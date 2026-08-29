import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { readFileBase64 } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";

// 32 MB of base64 (≈24 MB of PDF) is as much as shoveling through IPC and a
// data URL deserves; larger files fall back to the explicit editor path.
const MAX_BASE64_LENGTH = 32 * 1024 * 1024;

// A project PDF rendered in the output panel — the compiled-preview pane
// shows the live build; this one shows any PDF file the session or the user
// opened (an imported figure source, an exported draft, …).
export function PdfFilePane({ path }: { path: string }) {
  const projectId = useFilesStore((s) => s.projectId);

  const { data, isPending, isError } = useQuery({
    queryKey: ["harness-pdf-file", projectId, path],
    queryFn: () => readFileBase64(projectId ?? "", path),
    enabled: !!projectId,
    staleTime: 5_000,
  });

  const tooLarge = typeof data === "string" && data.length > MAX_BASE64_LENGTH;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="harness-pdf-file">
      {isPending ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading PDF…
        </div>
      ) : isError ? (
        <p className="p-4 text-xs text-muted-foreground">
          The PDF could not be read. It may have been moved or deleted.
        </p>
      ) : tooLarge ? (
        <p className="p-4 text-xs text-muted-foreground">
          This PDF is too large to preview inline. Use the files panel to open it in the
          workspace instead.
        </p>
      ) : (
        <embed
          data-testid="harness-pdf-embed"
          src={`data:application/pdf;base64,${data}`}
          type="application/pdf"
          className="min-h-0 flex-1"
        />
      )}
    </div>
  );
}
