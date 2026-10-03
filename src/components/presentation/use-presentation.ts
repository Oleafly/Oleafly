import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadPresentationPdf } from "@/features/presentation/load";
import {
  PRESENTATION_EVENTS,
  applySlideAction,
  clampSlide,
  slideActionForKey,
  type PresentationParams,
  type SlideAction,
} from "@/features/presentation/navigation";
import type { SlideDocument } from "@/features/presentation/pdf-slides";

export type PresentationDeck =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly document: SlideDocument }
  | { readonly status: "failed" };

interface SessionPayload {
  readonly session?: unknown;
  readonly page?: unknown;
  readonly blank?: unknown;
}

const TYPING_TARGET = "button, input, textarea, select, [contenteditable='true']";

export function usePresentationDeck(params: PresentationParams | null): PresentationDeck {
  const [deck, setDeck] = useState<PresentationDeck>(params ? { status: "loading" } : { status: "failed" });
  useEffect(() => {
    if (!params) return;
    let disposed = false;
    let opened: SlideDocument | null = null;
    void (async () => {
      try {
        const [bytes, { openSlideDocument }] = await Promise.all([
          loadPresentationPdf(params),
          import("@/features/presentation/pdf-slides"),
        ]);
        if (disposed) return;
        opened = await openSlideDocument(bytes);
        if (disposed) {
          opened.destroy();
          return;
        }
        setDeck({ status: "ready", document: opened });
      } catch {
        if (!disposed) setDeck({ status: "failed" });
      }
    })();
    return () => {
      disposed = true;
      opened?.destroy();
    };
  }, [params]);
  return deck;
}

function closeWindow(): void {
  void getCurrentWindow()
    .close()
    .catch(() => {});
}

export function usePresentationControls(params: PresentationParams | null, total: number) {
  const [page, setPage] = useState(params?.start ?? 1);
  const [blank, setBlank] = useState(false);
  const pageRef = useRef(page);
  const blankRef = useRef(blank);
  const totalRef = useRef(total);
  pageRef.current = page;
  blankRef.current = blank;
  totalRef.current = total;

  useEffect(() => {
    if (total > 0) setPage((current) => clampSlide(current, total));
  }, [total]);

  const end = useCallback(() => {
    if (params) void emit(PRESENTATION_EVENTS.end, { session: params.session }).catch(() => {});
    closeWindow();
  }, [params]);

  const act = useCallback(
    (action: SlideAction) => {
      if (!params) return;
      if (action === "end") {
        end();
        return;
      }
      if (action === "blank") {
        const next = !blankRef.current;
        blankRef.current = next;
        setBlank(next);
        void emit(PRESENTATION_EVENTS.blank, { session: params.session, blank: next }).catch(() => {});
        return;
      }
      if (totalRef.current < 1) return;
      const next = applySlideAction(action, pageRef.current, totalRef.current);
      pageRef.current = next;
      setPage(next);
      void emit(PRESENTATION_EVENTS.goto, { session: params.session, page: next }).catch(() => {});
    },
    [params, end],
  );

  useEffect(() => {
    if (!params) return;
    const mine = (payload: SessionPayload | undefined) => payload?.session === params.session;
    const listeners = [
      listen<SessionPayload>(PRESENTATION_EVENTS.goto, ({ payload }) => {
        if (!mine(payload) || typeof payload.page !== "number" || !Number.isInteger(payload.page)) return;
        const target = payload.page;
        setPage(totalRef.current > 0 ? clampSlide(target, totalRef.current) : Math.max(1, target));
      }),
      listen<SessionPayload>(PRESENTATION_EVENTS.blank, ({ payload }) => {
        if (mine(payload)) setBlank(payload.blank === true);
      }),
      listen<SessionPayload>(PRESENTATION_EVENTS.end, ({ payload }) => {
        if (mine(payload)) closeWindow();
      }),
      getCurrentWindow().onCloseRequested(() => {
        void emit(PRESENTATION_EVENTS.end, { session: params.session }).catch(() => {});
      }),
    ];
    return () => {
      for (const listener of listeners) {
        void listener.then((unlisten) => unlisten()).catch(() => {});
      }
    };
  }, [params]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = slideActionForKey(event);
      if (!action) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(TYPING_TARGET) && (event.key === " " || event.key === "Enter")) {
        return;
      }
      event.preventDefault();
      act(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  return { page, blank, act, end };
}
