import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { TOOLTIP_BUBBLE_CLASS } from "@/components/ui/tooltip";
import { cn, modKey } from "@/lib/utils";
import type { TerminalLinkHover } from "./terminal-link-provider";

export interface TerminalLinkTip extends TerminalLinkHover {
  x: number;
  y: number;
}

const POINTER_GAP = 14;
const MARGIN = 8;

export function TerminalLinkTooltip({ tip }: Readonly<{ tip: TerminalLinkTip }>) {
  const { t } = useTranslation(["workspace"]);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    let top = tip.y + POINTER_GAP;
    if (top + box.height > window.innerHeight - MARGIN) top = tip.y - POINTER_GAP - box.height;
    const left = Math.min(tip.x + POINTER_GAP, window.innerWidth - box.width - MARGIN);
    setPos({ top: Math.max(MARGIN, top), left: Math.max(MARGIN, left) });
  }, [tip]);

  const hint =
    tip.kind === "url"
      ? t(($) => $.workspace.terminal.links.openUrl, { modifier: modKey })
      : t(($) => $.workspace.terminal.links.openFile, { modifier: modKey });

  return createPortal(
    <span
      ref={ref}
      role="tooltip"
      className={cn(
        TOOLTIP_BUBBLE_CLASS,
        "flex w-max max-w-[360px] flex-col gap-0.5 whitespace-normal",
        !pos && "opacity-0",
      )}
      style={pos ?? { top: -9999, left: -9999 }}
    >
      <span className="font-mono [overflow-wrap:anywhere]">{tip.label}</span>
      <span className="text-muted-foreground">{hint}</span>
    </span>,
    document.body,
  );
}
