import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SandboxedFrame } from "@/components/notes/artifact-runtime/frame-host";
import { PdfStateMessage } from "@/components/preview/PdfStateMessage";
import { PRESENT_MODES, type PresentMode } from "@/components/preview/PdfToolbarControls";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { Spinner } from "@/components/ui/spinner";
import { useFilesStore } from "@/store/files";
import { type DeckPosition, useDeckFrame } from "./use-deck-frame";

export interface DeckViewProps {
  readonly projectId: string;
  readonly path: string;
  readonly onPresent?: (mode: PresentMode, page: number) => void;
}

const positions = new Map<string, DeckPosition>();

export function DeckView({ projectId, path, onPresent }: DeckViewProps) {
  const { t } = useTranslation(["common", "preview"]);
  const code = useFilesStore((state) => state.files[path]?.content ?? "");
  const key = `${projectId}\n${path}`;
  const saved = positions.get(key);
  const deck = useDeckFrame({
    projectId,
    path,
    code,
    mode: "edit",
    startPage: saved?.page ?? 0,
    startRevealed: saved?.revealed,
  });
  const shown = deck.error === null ? deck.info : null;
  const total = shown?.pages ?? 0;
  const page = deck.position.page;
  const notes = shown?.notes[page] ?? null;

  useEffect(() => {
    if (deck.info) positions.set(key, deck.position);
  }, [deck.info, deck.position, key]);
  const label = total > 0 ? t(($) => $.preview.presentation.slideLabel, { page: page + 1, total }) : "";

  return (
    <div data-testid="deck-view" className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex min-h-9 shrink-0 items-center gap-1 border-b bg-background px-2">
        <TooltipIconButton
          label={t(($) => $.preview.presentation.previousAction)}
          disabled={total === 0 || (page === 0 && deck.position.revealed === 0)}
          onClick={() => deck.send({ type: "previous" })}
        >
          <ChevronLeft aria-hidden />
        </TooltipIconButton>
        <output className="min-w-24 text-center text-xs tabular-nums text-muted-foreground">{label}</output>
        <TooltipIconButton
          label={t(($) => $.preview.presentation.nextAction)}
          disabled={total === 0 || (page >= total - 1 && deck.position.revealed >= deck.position.steps)}
          onClick={() => deck.send({ type: "next" })}
        >
          <ChevronRight aria-hidden />
        </TooltipIconButton>
        {onPresent ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-auto gap-1.5" disabled={total === 0}>
                <Play aria-hidden className="size-3.5" />
                {t(($) => $.preview.presentation.present)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {PRESENT_MODES.map(({ mode, label }) => (
                <DropdownMenuItem key={mode} onSelect={() => onPresent(mode, mode === "start" ? 0 : page)}>
                  {label()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 p-4">
        {deck.failure ? (
          <div className="flex h-full items-center justify-center">
            <PdfStateMessage kind="error" title={t(($) => $.preview.presentation.failed)} detail={deck.failure} />
          </div>
        ) : deck.url ? (
          <SandboxedFrame
            ref={deck.frameRef}
            src={deck.url}
            onLoad={deck.onLoad}
            title={label || t(($) => $.preview.presentation.windowTitle)}
            className="size-full border-0 bg-transparent"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner size="lg" aria-label={t(($) => $.common.state.loading)} />
          </div>
        )}
      </div>
      {notes ? (
        <section
          aria-label={t(($) => $.preview.presentation.notes)}
          className="max-h-32 shrink-0 overflow-y-auto border-t bg-background px-4 py-2 text-sm whitespace-pre-wrap text-muted-foreground"
        >
          {notes}
        </section>
      ) : null}
    </div>
  );
}
