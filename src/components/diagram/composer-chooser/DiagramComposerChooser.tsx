import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChoiceCard } from "@/components/library/ChoiceCard";
import { CHOICE_ART } from "@/components/library/choice-art";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { openDiagramComposer } from "@/features/open-tool";
import {
  DIAGRAM_COMPOSER_LANGUAGES,
  useDiagramComposerStore,
  type DiagramComposerLanguage,
} from "@/store/diagram-composer";

const ART: Record<DiagramComposerLanguage, string> = {
  tikz: CHOICE_ART.diagramTikz,
  typst: CHOICE_ART.diagramTypst,
  mermaid: CHOICE_ART.diagramMermaid,
};

const KEY_STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

function moveBetweenCards(event: KeyboardEvent, grid: HTMLElement | null) {
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  const index = cards.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  let next: number;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = cards.length - 1;
  else if (event.key in KEY_STEPS) next = (index + KEY_STEPS[event.key] + cards.length) % cards.length;
  else return;
  event.preventDefault();
  cards[next].focus();
}

export function DiagramComposerChooser({
  open,
  onClose,
  onChoose,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  onChoose: (language: DiagramComposerLanguage) => void;
}>) {
  const { t } = useTranslation(["diagram"]);
  const grid = useRef<HTMLDivElement>(null);
  const copy: Record<DiagramComposerLanguage, { title: string; description: string }> = {
    tikz: {
      title: t(($) => $.diagram.chooser.tikz.title),
      description: t(($) => $.diagram.chooser.tikz.description),
    },
    typst: {
      title: t(($) => $.diagram.chooser.typst.title),
      description: t(($) => $.diagram.chooser.typst.description),
    },
    mermaid: {
      title: t(($) => $.diagram.chooser.mermaid.title),
      description: t(($) => $.diagram.chooser.mermaid.description),
    },
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-testid="diagram-composer-chooser"
        className="max-w-3xl gap-5"
        onKeyDown={(event) => moveBetweenCards(event, grid.current)}
      >
        <DialogHeader>
          <DialogTitle>{t(($) => $.diagram.chooser.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.diagram.chooser.description)}</DialogDescription>
        </DialogHeader>
        <div ref={grid} className="grid gap-3 sm:grid-cols-3">
          {DIAGRAM_COMPOSER_LANGUAGES.map((language) => (
            <ChoiceCard
              key={language}
              image={ART[language]}
              title={copy[language].title}
              description={copy[language].description}
              testId={`diagram-composer-choice-${language}`}
              onClick={() => onChoose(language)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DiagramComposerChooserHost() {
  const open = useDiagramComposerStore((state) => state.chooserOpen);
  const setChooserOpen = useDiagramComposerStore((state) => state.setChooserOpen);
  const [chosen, setChosen] = useState(false);
  useEffect(() => {
    if (open) setChosen(false);
  }, [open]);
  if (chosen) return null;
  return (
    <DiagramComposerChooser
      open={open}
      onClose={() => setChooserOpen(false)}
      onChoose={(language) => {
        setChosen(true);
        void openDiagramComposer(language);
      }}
    />
  );
}
