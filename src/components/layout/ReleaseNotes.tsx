import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function openableReleaseLink(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return OPENABLE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export const PRIMARY_TEXT = "text-primary dark:text-[color-mix(in_oklab,var(--primary)_72%,white)]";

type RendererModule = typeof import("./release-notes-renderer");

let loadedRenderer: RendererModule | null = null;
let rendererLoad: Promise<RendererModule> | null = null;

export function loadReleaseNotesRenderer(): Promise<RendererModule> {
  rendererLoad ??= import("./release-notes-renderer").then(
    (module) => {
      loadedRenderer = module;
      return module;
    },
    (error: unknown) => {
      rendererLoad = null;
      throw error;
    },
  );
  return rendererLoad;
}

function useReleaseNotesRenderer(): RendererModule | null {
  const [renderer, setRenderer] = useState(loadedRenderer);
  useEffect(() => {
    if (renderer) return;
    let live = true;
    loadReleaseNotesRenderer().then(
      (module) => {
        if (live) setRenderer(module);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [renderer]);
  return renderer;
}

export const ReleaseNotes = memo(function ReleaseNotes({
  source,
  onOpenLink,
  className,
}: Readonly<{
  source: string;
  onOpenLink: (url: string) => void;
  className?: string;
}>) {
  const renderer = useReleaseNotesRenderer();
  return (
    <div
      data-testid="release-notes"
      className={cn("min-w-0 break-words text-[13px] text-muted-foreground", className)}
    >
      {renderer ? (
        <renderer.ReleaseNotesMarkdown source={source} onOpenLink={onOpenLink} />
      ) : (
        <div className="whitespace-pre-wrap leading-relaxed">{source}</div>
      )}
    </div>
  );
});
