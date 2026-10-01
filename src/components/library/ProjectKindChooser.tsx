import { useTranslation } from "react-i18next";
import { ChoiceCard } from "@/components/library/ChoiceCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ProjectKind = "research" | "import" | "template";

const KINDS: { id: ProjectKind; thumbnail: string }[] = [
  { id: "research", thumbnail: "/project-kind/research-project-light.webp" },
  { id: "import", thumbnail: "/project-kind/import-project-light.webp" },
  { id: "template", thumbnail: "/project-kind/use-template-light.webp" },
];

export function ProjectKindChooser({
  open,
  allowClose = true,
  onClose,
  onChoose,
}: Readonly<{
  open: boolean;
  allowClose?: boolean;
  onClose: () => void;
  onChoose: (kind: ProjectKind) => void;
}>) {
  const { t } = useTranslation(["library"]);
  const copy: Record<ProjectKind, { title: string; description: string }> = {
    research: {
      title: t(($) => $.library.kinds.research.title),
      description: t(($) => $.library.kinds.research.description),
    },
    import: {
      title: t(($) => $.library.kinds.import.title),
      description: t(($) => $.library.kinds.import.description),
    },
    template: {
      title: t(($) => $.library.kinds.template.title),
      description: t(($) => $.library.kinds.template.description),
    },
  };
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
          <DialogTitle>{t(($) => $.library.kinds.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.library.kinds.description)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {KINDS.map((kind) => (
            <ChoiceCard
              key={kind.id}
              image={kind.thumbnail}
              title={copy[kind.id].title}
              description={copy[kind.id].description}
              testId={`project-kind-${kind.id}`}
              tour={`project-kind-${kind.id}`}
              onClick={() => onChoose(kind.id)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
