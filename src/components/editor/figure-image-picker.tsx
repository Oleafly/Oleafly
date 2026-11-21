import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, ImageOff } from "lucide-react";
import type { FileEntry } from "@oleafly/backend-port";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { figureDirectory } from "@/components/editor/figure-import";
import { resolveVisualAssetUrl } from "@/components/editor/wysiwyg/asset-url";
import { INSERTABLE_IMAGE_EXTENSIONS, isInsertableImagePath } from "@/lib/image-mime";
import { logError } from "@/lib/log";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";

export function projectImagePaths(tree: readonly FileEntry[]): string[] {
  return tree
    .filter((entry) => !entry.is_dir && isInsertableImagePath(entry.path))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
}

export function useAssetUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setUrl(null);
    resolveVisualAssetUrl(path).then(
      (value) => {
        if (active) setUrl(typeof value === "string" ? value : null);
      },
      () => {
        if (active) setUrl(null);
      },
    );
    return () => {
      active = false;
    };
  }, [path]);
  return url;
}

function Thumbnail({ path }: Readonly<{ path: string }>) {
  const { t } = useTranslation(["common", "editor"]);
  const url = useAssetUrl(path);
  return (
    <span className="flex h-20 w-full items-center justify-center overflow-hidden rounded bg-muted/40">
      {url ? (
        <img src={url} alt={t(($) => $.editor.figureDialog.thumbnailAlt, { path })} className="max-h-full max-w-full object-contain" />
      ) : (
        <ImageOff className="size-5 text-muted-foreground" aria-label={t(($) => $.editor.figureDialog.noPreview)} />
      )}
    </span>
  );
}

function ImageGrid({
  images,
  selected,
  numbered,
  testId,
  onChoose,
}: Readonly<{
  images: string[];
  selected: readonly string[];
  numbered: boolean;
  testId: string;
  onChoose: (path: string) => void;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  if (images.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        {t(($) => $.editor.figureDialog.noProjectImages)}
      </p>
    );
  }
  return (
    <div className={cn("grid grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3", numbered ? "max-h-48" : "max-h-72")}>
      {images.map((path) => {
        const position = selected.indexOf(path);
        return (
          <button
            key={path}
            type="button"
            aria-pressed={position >= 0}
            data-testid={`${testId}-image`}
            data-path={path}
            onClick={() => onChoose(path)}
            className={cn(
              "relative flex w-full flex-col gap-1 rounded-md border p-2 text-left transition-colors hover:bg-accent",
              position >= 0 ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <Thumbnail path={path} />
            <span className="truncate text-[0.6875rem] text-foreground">{path}</span>
            {numbered && position >= 0 ? <Badge size="count">{position + 1}</Badge> : null}
          </button>
        );
      })}
    </div>
  );
}

async function pickImageSources(filterName: string, multiple: boolean): Promise<string[]> {
  const picked = await pickOpenPath({
    multiple,
    filters: [{ name: filterName, extensions: INSERTABLE_IMAGE_EXTENSIONS }],
  });
  const sources = Array.isArray(picked) ? picked : [picked];
  return sources.filter((source): source is string => typeof source === "string" && source !== "");
}

export function ProjectImagePicker({
  selected,
  multiple,
  testId,
  onChoose,
  onImported,
}: Readonly<{
  selected: readonly string[];
  multiple: boolean;
  testId: string;
  onChoose: (path: string) => void;
  onImported: (paths: string[]) => void;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const tree = useFilesStore((state) => state.tree);
  const projectId = useFilesStore((state) => state.projectId);
  const importPaths = useFilesStore((state) => state.importPaths);
  const images = useMemo(() => projectImagePaths(tree), [tree]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importFromDisk = async () => {
    if (importing || !projectId) return;
    setImporting(true);
    setError(null);
    try {
      const sources = await pickImageSources(t(($) => $.editor.figureDialog.imageFilter), multiple);
      if (sources.length === 0) return;
      const state = useFilesStore.getState();
      const before = new Set(state.tree.map((entry) => entry.path));
      await importPaths(figureDirectory(state.tree, state.mainDoc), sources);
      const added = projectImagePaths(useFilesStore.getState().tree).filter((path) => !before.has(path));
      if (added.length > 0) onImported(added);
      else setError(t(($) => $.editor.figureDialog.importFailed));
    } catch (e) {
      void logError("import figure", e);
      setError(t(($) => $.editor.figureDialog.importFailed));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t(($) => $.editor.figureDialog.projectImages)}
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={importing || !projectId}
          data-testid={`${testId}-import`}
          onClick={() => void importFromDisk()}
        >
          {importing ? <Spinner size="sm" /> : <FolderOpen aria-hidden className="size-3.5" />}
          {importing ? t(($) => $.editor.figureDialog.importing) : t(($) => $.editor.figureDialog.importFromDisk)}
        </Button>
      </div>
      <ImageGrid images={images} selected={selected} numbered={multiple} testId={testId} onChoose={onChoose} />
      {error && (
        <p role="alert" className="mt-2 select-text text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
