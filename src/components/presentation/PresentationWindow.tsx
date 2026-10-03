import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { readPresentationParams } from "@/features/presentation/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { SlideCanvas } from "./SlideCanvas";
import { usePresentationControls, usePresentationDeck } from "./use-presentation";

const CURSOR_IDLE_MS = 2_000;

function usePointerControls(onNext: () => void, onPrevious: () => void): boolean {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const next = useRef(onNext);
  const previous = useRef(onPrevious);
  next.current = onNext;
  previous.current = onPrevious;
  useEffect(() => {
    const wake = () => {
      setIdle(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setIdle(true), CURSOR_IDLE_MS);
    };
    const click = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      next.current();
    };
    const contextMenu = (event: MouseEvent) => {
      event.preventDefault();
      previous.current();
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("click", click);
    window.addEventListener("contextmenu", contextMenu);
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("click", click);
      window.removeEventListener("contextmenu", contextMenu);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return idle;
}

export function PresentationWindow() {
  const { t } = useTranslation(["preview"]);
  const [params] = useState(() => readPresentationParams(window.location.search));
  const deck = usePresentationDeck(params);
  const total = deck.status === "ready" ? deck.document.numPages : 0;
  const { page, blank, act, end } = usePresentationControls(params, total);
  const idle = usePointerControls(
    () => act("next"),
    () => act("previous"),
  );

  return (
    <div
      data-testid="presentation-audience"
      className={cn(
        "fixed inset-0 flex select-none items-center justify-center bg-black text-white",
        idle && deck.status === "ready" && "cursor-none",
      )}
    >
      {deck.status === "ready" && !blank && (
        <SlideCanvas
          document={deck.document}
          page={page}
          className="size-full"
          label={t(($) => $.preview.presentation.slideLabel, { page, total })}
        />
      )}
      {deck.status === "loading" && (
        <output className="flex flex-col items-center gap-3 text-sm text-white/70" aria-live="polite">
          <Spinner size="xl" />
          {t(($) => $.preview.presentation.loading)}
        </output>
      )}
      {deck.status === "failed" && (
        <div role="alert" className="flex max-w-sm flex-col items-center gap-3 px-6 text-center text-sm text-white/80">
          <p>{t(($) => $.preview.presentation.failed)}</p>
          <Button variant="secondary" size="sm" onClick={end}>
            {t(($) => $.preview.presentation.close)}
          </Button>
        </div>
      )}
    </div>
  );
}
