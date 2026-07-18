import { useEffect, useState } from "react";
import { ExternalLink, Globe, Github, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { UpdateChecker } from "@/components/layout/UpdateChecker";
import { appVersion } from "@/lib/tauri";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

const REPO = "https://github.com/prajwal-svm/OpenLeaf";
const AUTHOR_URL = "http://prajwal.me";
const DOCS = "https://www.overleaf.com/learn";

export function AboutModal({ open: isOpen, onClose }: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = useState("");
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(isOpen, onClose);

  useEffect(() => {
    if (isOpen) void appVersion().then(setVersion).catch(() => setVersion(""));
  }, [isOpen]);

  if (!isOpen) return null;

  const ext = (url: string) => () => void open(url);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
    >
      <button type="button" aria-label="Close About Oleafly" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="about-title"
        className="relative w-full max-w-sm rounded-xl border bg-popover p-6 text-popover-foreground shadow-2xl"
      >
        <button
          type="button"
          data-modal-initial-focus
          onClick={onClose}
          className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <LeafLogo className="size-12" />
          <h2 id="about-title" className="mt-3 text-base font-semibold">Oleafly</h2>
          {version && (
            <span className="mt-0.5 text-xs text-muted-foreground">Version {version}</span>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            A local-first, cross-platform LaTeX &amp; resume authoring app.
          </p>
          <UpdateChecker className="mt-3 flex flex-col items-center" />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Author</p>
            <button
              type="button"
              onClick={ext(AUTHOR_URL)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">Prajwal Murthy</span>
              <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Project</p>
            <button
              type="button"
              onClick={ext(REPO)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <Github className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">GitHub</span>
              <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={ext(`${REPO}#readme`)}>
            Learn more
          </Button>
          <Button size="sm" className="flex-1" onClick={ext(DOCS)}>
            Documentation
          </Button>
        </div>
      </div>
    </div>
  );
}
