import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadPresentationDeck, loadPresentationPdf } from "@/features/presentation/load";
import {
  PRESENTATION_EVENTS,
  applySlideAction,
  clampSlide,
  slideActionForKey,
  type PresentationParams,
  type SlideAction,
} from "@/features/presentation/navigation";
import type { SlideDocument } from "@/features/presentation/pdf-slides";
import { logWarning } from "@/lib/log";

export type PresentationDeck =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly document: SlideDocument }
  | { readonly status: "deck"; readonly path: string; readonly code: string }
  | { readonly status: "failed" };

export type StepAction = "next" | "previous";

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
    if (params.source.kind === "deck") {
      const path = params.source.path;
      loadPresentationDeck(params).then(
        (code) => {
          if (!disposed) setDeck({ status: "deck", path, code });
        },
        (cause: unknown) => {
          if (disposed) return;
          void logWarning(`open the slide deck ${path} to present`, cause);
          setDeck({ status: "failed" });
        },
      );
      return () => {
        disposed = true;
      };
    }
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
      } catch (cause) {
        if (disposed) return;
        void logWarning("open the PDF to present", cause);
        setDeck({ status: "failed" });
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

export interface PresentationStepping {
  readonly route?: (action: StepAction) => boolean;
  readonly onStep?: (action: StepAction) => void;
}

export function usePresentationControls(
  params: PresentationParams | null,
  total: number,
  stepping: PresentationStepping = {},
) {
  const steppingRef = useRef(stepping);
  steppingRef.current = stepping;
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
      if ((action === "next" || action === "previous") && steppingRef.current.route?.(action)) return;
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
      listen<SessionPayload & { action?: unknown }>(PRESENTATION_EVENTS.step, ({ payload }) => {
        if (!mine(payload) || (payload.action !== "next" && payload.action !== "previous")) return;
        steppingRef.current.onStep?.(payload.action);
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

  const show = useCallback(
    (next: number) => {
      if (!params || next === pageRef.current) return;
      pageRef.current = next;
      setPage(next);
      void emit(PRESENTATION_EVENTS.goto, { session: params.session, page: next }).catch(() => {});
    },
    [params],
  );

  const step = useCallback(
    (action: StepAction) => {
      if (params) void emit(PRESENTATION_EVENTS.step, { session: params.session, action }).catch(() => {});
    },
    [params],
  );

  return { page, blank, act, end, show, step };
}
