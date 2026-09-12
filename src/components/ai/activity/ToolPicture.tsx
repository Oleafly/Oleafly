import { useState } from "react";
import { Check, Code2, Copy, FolderDown, Image as ImageIcon } from "lucide-react";
import type { ToolEntry } from "@/store/chats";
import { TikzSourceView } from "@/components/ai/TikzSourceView";
import { Tooltip } from "@/components/ui/tooltip";
import { writeProjectBytes } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";

export function lastFinishedPicture(tools: readonly ToolEntry[]): ToolEntry[] {
  for (let i = tools.length - 1; i >= 0; i--) {
    const tool = tools[i];
    if (tool.image && tool.status === "done") return [tool];
  }
  return [];
}

export function freeFigurePath(
  existing: readonly string[],
  extension: string,
  base = "figure",
): string {
  const taken = new Set(existing.map((path) => path.toLowerCase()));
  const first = `figures/${base}.${extension}`;
  if (!taken.has(first.toLowerCase())) return first;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `figures/${base}-${n}.${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `figures/${base}-${Date.now()}.${extension}`;
}

async function saveToolPicture(tc: ToolEntry): Promise<string | null> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return null;
  const existing = files.tree.map((entry) => entry.path);
  if (tc.code) {
    const path = freeFigurePath(existing, "tex");
    await files.writeProjectFile(
      projectId,
      path,
      tc.code.endsWith("\n") ? tc.code : `${tc.code}\n`,
    );
    return path;
  }
  if (tc.image) {
    const path = freeFigurePath(existing, "png");
    const base64 = tc.image.split(",")[1] ?? "";
    await writeProjectBytes(projectId, path, base64);
    await files.refreshTree();
    return path;
  }
  return null;
}

export function ToolPicture({ tc }: { tc: ToolEntry }) {
  const [view, setView] = useState<"image" | "code">("image");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasCode = Boolean(tc.code);
  const label = tc.name === "preview_figure" ? "Rendered figure preview" : "Image from the tool";
  const copyCode = async () => {
    if (!tc.code) return;
    try {
      await navigator.clipboard.writeText(tc.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const saveToProject = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const path = await saveToolPicture(tc);
      if (path) toast.success(`Saved ${path}`);
      else toast.error("Open a project to save this figure.");
    } catch (error) {
      toast.error(`Could not save the figure: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };
  const pill = (active: boolean) =>
    cn(
      "flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
    );
  const iconButton =
    "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60";
  return (
    <div data-testid="tool-picture-body" className="bg-background">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b px-2 py-1">
        <span />
        {hasCode ? (
          <div className="flex h-7 items-center rounded-full bg-muted p-0.5 text-[11px] font-medium">
            <button
              type="button"
              data-testid="tool-picture-view-image"
              aria-label="Show the rendered figure"
              aria-pressed={view === "image"}
              onClick={() => setView("image")}
              className={pill(view === "image")}
            >
              <ImageIcon className="size-3.5" />
              Figure
            </button>
            <button
              type="button"
              data-testid="tool-picture-view-code"
              aria-label="Show the TikZ source"
              aria-pressed={view === "code"}
              onClick={() => setView("code")}
              className={pill(view === "code")}
            >
              <Code2 className="size-3.5" />
              TikZ
            </button>
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center justify-end gap-0.5">
          <Tooltip label={saving ? "Saving" : "Save to project"}>
            <button
              type="button"
              data-testid="tool-picture-save"
              aria-label="Save to project"
              disabled={saving}
              onClick={() => void saveToProject()}
              className={iconButton}
            >
              <FolderDown className="size-3.5" />
            </button>
          </Tooltip>
          {hasCode && (
            <Tooltip label={copied ? "Copied" : "Copy code"}>
              <button
                type="button"
                data-testid="tool-picture-copy"
                aria-label="Copy code"
                onClick={() => void copyCode()}
                className={iconButton}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      {view === "image" || !hasCode ? (
        <div className="p-2">
          <img
            src={tc.image}
            alt={label}
            data-testid="tool-image"
            className="mx-auto max-h-80 max-w-full rounded object-contain"
          />
        </div>
      ) : (
        <TikzSourceView source={tc.code ?? ""} />
      )}
    </div>
  );
}
