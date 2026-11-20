import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DeckFrameMode } from "@/components/notes/artifact-runtime/frame-document";
import { SandboxedFrame } from "@/components/notes/artifact-runtime/frame-host";
import { type DeckCommand, type DeckInfo, useDeckFrame } from "@/components/editor/deck/use-deck-frame";
import { InlineAlert } from "@/components/ui/inline-alert";
import { cn } from "@/lib/utils";

export interface DeckSlideProps {
  readonly projectId: string;
  readonly path: string;
  readonly code: string;
  readonly page: number;
  readonly mode: DeckFrameMode;
  readonly label: string;
  readonly className?: string;
  readonly onInfo?: (info: DeckInfo) => void;
  readonly onPage?: (page: number) => void;
  readonly commands?: { current: ((command: DeckCommand) => void) | null };
}

export function DeckSlide({ projectId, path, code, page, mode, label, className, onInfo, onPage, commands }: DeckSlideProps) {
  const { t } = useTranslation(["preview"]);
  const deck = useDeckFrame({ projectId, path, code, mode, startPage: page - 1 });
  const { info, position, send } = deck;
  const onInfoRef = useRef(onInfo);
  onInfoRef.current = onInfo;
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;

  useEffect(() => {
    if (commands) commands.current = send;
  }, [commands, send]);

  useEffect(() => {
    if (info) onInfoRef.current?.(info);
  }, [info]);

  useEffect(() => {
    if (info) onPageRef.current?.(position.page + 1);
  }, [info, position.page]);

  const shownPage = useRef(position.page);
  shownPage.current = position.page;
  const ready = useRef(info !== null);
  ready.current = info !== null;
  const requested = useRef(page);
  useEffect(() => {
    if (requested.current === page) return;
    requested.current = page;
    if (ready.current && shownPage.current !== page - 1) send({ type: "goto", page: page - 1 });
  }, [page, send]);

  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      {deck.failure ? (
        <div className="flex size-full items-center justify-center p-6">
          <InlineAlert className="max-w-md text-center">{t(($) => $.preview.presentation.failed)}</InlineAlert>
        </div>
      ) : deck.url ? (
        <SandboxedFrame
          ref={deck.frameRef}
          src={deck.url}
          onLoad={deck.onLoad}
          title={label}
          className="pointer-events-none size-full border-0 bg-transparent"
        />
      ) : null}
    </div>
  );
}
