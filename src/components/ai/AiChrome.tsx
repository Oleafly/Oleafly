import type { ReactNode } from "react";
import { Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Gemini-inspired blue → purple → coral gradient used for AI prompt chrome. */
export const AI_GRADIENT = "from-[#4285F4] via-[#9B72CB] to-[#D96570]";

/** Magic-wand mark — shared AI identity (no chip background). */
export function AiMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("flex size-7 shrink-0 items-center justify-center text-foreground/80", className)}
      aria-hidden
    >
      <Wand2 className="size-5" />
    </span>
  );
}

/**
 * Gemini-style gradient border shell with a soft tinted fill.
 * Use around any AI prompt / approval card.
 */
export function AiChrome({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl bg-gradient-to-br p-[1.5px] shadow-lg shadow-[#9B72CB]/20",
        AI_GRADIENT,
        className,
      )}
    >
      <div
        className={cn("rounded-[10px] backdrop-blur-sm", contentClassName)}
        style={{
          background:
            "linear-gradient(135deg, rgba(66,133,244,0.10) 0%, rgba(155,114,203,0.12) 50%, rgba(217,101,112,0.10) 100%), var(--background)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
