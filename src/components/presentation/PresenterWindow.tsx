import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, EyeOff, Pause, Play, RotateCcw, X } from "lucide-react";
import { loadPresentationNotes } from "@/features/presentation/load";
import { formatElapsed, readPresentationParams, type PresentationParams } from "@/features/presentation/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { formatTime } from "@/lib/intl";
import { SlideCanvas } from "./SlideCanvas";
import { usePresentationControls, usePresentationDeck } from "./use-presentation";

const TICK_MS = 1_000;

function useTimer() {
  const [now, setNow] = useState(() => Date.now());
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, []);
  const elapsed = (pausedAt ?? now) - startedAt;
  return {
    now,
    elapsed,
    paused: pausedAt !== null,
    toggle: () => {
      const current = Date.now();
      if (pausedAt === null) {
        setPausedAt(current);
      } else {
        setStartedAt((started) => started + (current - pausedAt));
        setPausedAt(null);
      }
      setNow(current);
    },
    reset: () => {
      const current = Date.now();
      setStartedAt(current);
      setPausedAt(pausedAt === null ? null : current);
      setNow(current);
    },
  };
}

function useNotes(params: PresentationParams | null): ReadonlyMap<number, string> | null {
  const [notes, setNotes] = useState<ReadonlyMap<number, string> | null>(null);
  useEffect(() => {
    if (!params) {
      setNotes(new Map());
      return;
    }
    let current = true;
    void loadPresentationNotes(params)
      .then((loaded) => {
        if (current) setNotes(loaded);
      })
      .catch(() => {
        if (current) setNotes(new Map());
      });
    return () => {
      current = false;
    };
  }, [params]);
  return notes;
}

function Panel({ title, children, className }: Readonly<{ title: string; children: ReactNode; className?: string }>) {
  return (
    <section aria-label={title} className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <h2 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function IconButton({ label, onClick, children }: Readonly<{ label: string; onClick: () => void; children: ReactNode }>) {
  return (
    <Tooltip label={label}>
      <Button variant="ghost" size="icon" className="size-8" aria-label={label} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

export function PresenterWindow() {
  const { t } = useTranslation(["preview"]);
  const [params] = useState(() => readPresentationParams(window.location.search));
  const deck = usePresentationDeck(params);
  const total = deck.status === "ready" ? deck.document.numPages : 0;
  const { page, blank, act, end } = usePresentationControls(params, total);
  const timer = useTimer();
  const notes = useNotes(params);
  const note = notes?.get(page);

  const notesBody = () => {
    if (notes === null) {
      return (
        <output className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          {t(($) => $.preview.presentation.notesLoading)}
        </output>
      );
    }
    if (!note) return <p className="text-sm text-muted-foreground">{t(($) => $.preview.presentation.noNotes)}</p>;
    return (
      <p data-testid="presenter-notes" className="select-text whitespace-pre-wrap text-lg leading-relaxed">
        {note}
      </p>
    );
  };

  const slides = () => {
    if (deck.status === "loading") {
      return (
        <output className="col-span-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t(($) => $.preview.presentation.loading)}
        </output>
      );
    }
    if (deck.status === "failed") {
      return (
        <p role="alert" className="col-span-2 self-center text-center text-sm text-muted-foreground">
          {t(($) => $.preview.presentation.failed)}
        </p>
      );
    }
    return (
      <>
        <Panel title={t(($) => $.preview.presentation.current)}>
          <SlideCanvas
            document={deck.document}
            page={page}
            className="flex-1 rounded-md bg-muted/60"
            canvasClassName="shadow-sm"
            label={t(($) => $.preview.presentation.slideLabel, { page, total })}
          />
        </Panel>
        <div className="flex min-h-0 flex-col gap-4">
          <Panel title={t(($) => $.preview.presentation.next)} className="h-2/5">
            {page < total ? (
              <SlideCanvas
                document={deck.document}
                page={page + 1}
                className="flex-1 rounded-md bg-muted/60"
                label={t(($) => $.preview.presentation.slideLabel, { page: page + 1, total })}
              />
            ) : (
              <p className="flex flex-1 items-center justify-center rounded-md bg-muted/60 text-sm text-muted-foreground">
                {t(($) => $.preview.presentation.lastSlide)}
              </p>
            )}
          </Panel>
          <Panel title={t(($) => $.preview.presentation.notes)} className="flex-1">
            <div className="min-h-0 flex-1 overflow-auto rounded-md border p-3">{notesBody()}</div>
          </Panel>
        </div>
      </>
    );
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground" data-testid="presenter-view">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <span className="text-sm font-semibold tabular-nums">
          {total > 0 ? t(($) => $.preview.presentation.slideLabel, { page, total }) : ""}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{t(($) => $.preview.presentation.elapsed)}</span>
          <span data-testid="presenter-timer" className="min-w-14 text-lg font-semibold tabular-nums">
            {formatElapsed(timer.elapsed)}
          </span>
          <IconButton
            label={timer.paused ? t(($) => $.preview.presentation.resume) : t(($) => $.preview.presentation.pause)}
            onClick={timer.toggle}
          >
            {timer.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </IconButton>
          <IconButton label={t(($) => $.preview.presentation.reset)} onClick={timer.reset}>
            <RotateCcw className="size-4" />
          </IconButton>
        </div>
        <span className="text-xs text-muted-foreground">
          <span className="sr-only">{t(($) => $.preview.presentation.clock)}</span>
          {formatTime(timer.now)}
        </span>
        {blank && (
          <output className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
            {t(($) => $.preview.presentation.blank)}
          </output>
        )}
        <div className="ml-auto flex items-center gap-1">
          <IconButton label={t(($) => $.preview.presentation.previousAction)} onClick={() => act("previous")}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label={t(($) => $.preview.presentation.nextAction)} onClick={() => act("next")}>
            <ChevronRight className="size-4" />
          </IconButton>
          <IconButton label={t(($) => $.preview.presentation.toggleBlank)} onClick={() => act("blank")}>
            <EyeOff className="size-4" />
          </IconButton>
          <Button variant="outline" size="sm" onClick={end}>
            <X data-icon="inline-start" />
            {t(($) => $.preview.presentation.end)}
          </Button>
        </div>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 p-4">{slides()}</main>
    </div>
  );
}
