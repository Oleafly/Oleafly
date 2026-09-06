import { ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ProjectKind = "research" | "import" | "template";

const KINDS: {
  id: ProjectKind;
  title: string;
  description: string;
  thumbnail: string;
}[] = [
  {
    id: "research",
    title: "Research project",
    description:
      "A study folder with sections, sources and review notes, and a first task that frames the question.",
    thumbnail: "/project-kind/research-project-light.webp",
  },
  {
    id: "import",
    title: "Import a project",
    description:
      "Continue a manuscript you already have: an archive, a Word or Markdown draft, or a GitHub repository.",
    thumbnail: "/project-kind/import-project-light.webp",
  },
  {
    id: "template",
    title: "Use a template",
    description:
      "Begin from a prepared layout for a journal article, thesis, report, poster or talk.",
    thumbnail: "/project-kind/use-template-light.webp",
  },
];

export function ProjectKindChooser({
  open,
  allowClose = true,
  onClose,
  onChoose,
}: {
  open: boolean;
  allowClose?: boolean;
  onClose: () => void;
  onChoose: (kind: ProjectKind) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && allowClose) onClose();
      }}
    >
      <DialogContent
        data-tour="project-kind-chooser"
        data-testid="project-kind-chooser"
        closeDisabled={!allowClose}
        onEscapeKeyDown={(event) => {
          if (!allowClose) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (!allowClose) event.preventDefault();
        }}
        className="max-w-3xl gap-5"
      >
        <DialogHeader>
          <DialogTitle>Start a new piece of work</DialogTitle>
          <DialogDescription>
            Choose how this manuscript begins. Every part of it stays yours to change.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {KINDS.map((kind) => (
            <button
              key={kind.id}
              type="button"
              data-tour={`project-kind-${kind.id}`}
              data-testid={`project-kind-${kind.id}`}
              onClick={() => onChoose(kind.id)}
              className={cn(
                "group flex h-full select-none flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all",
                "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              <img
                src={kind.thumbnail}
                alt=""
                aria-hidden="true"
                draggable={false}
                loading="lazy"
                decoding="async"
                className="pointer-events-none aspect-[16/9] w-full select-none object-cover"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                    {kind.title}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                  />
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {kind.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
