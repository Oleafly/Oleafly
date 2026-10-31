import { useId } from "react";
import { ArrowRight } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const IMAGE_WIDTH = 720;
const IMAGE_HEIGHT = 406;

export function ChoiceCard({
  image,
  title,
  description,
  onClick,
  testId,
  tour,
  disabled = false,
  busy = false,
  compact = false,
}: Readonly<{
  image: string;
  title: string;
  description: string;
  onClick: () => void;
  testId: string;
  tour?: string;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
}>) {
  const descriptionId = useId();
  return (
    <button
      type="button"
      data-testid={testId}
      data-tour={tour}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-describedby={descriptionId}
      onClick={onClick}
      className={cn(
        "group flex h-full select-none flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all",
        "enabled:hover:-translate-y-0.5 enabled:hover:border-primary/50 enabled:hover:shadow-md",
        "focus-visible:border-primary disabled:cursor-default disabled:opacity-60",
      )}
    >
      <img
        src={image}
        alt=""
        aria-hidden="true"
        width={IMAGE_WIDTH}
        height={IMAGE_HEIGHT}
        draggable={false}
        loading="eager"
        decoding="async"
        className={cn(
          "pointer-events-none w-full select-none bg-[#acd2f8] object-cover",
          compact ? "aspect-[9/4]" : "aspect-[16/9]",
        )}
      />
      <span className={cn("flex min-w-0 flex-1 flex-col", compact ? "gap-1 p-3" : "gap-1.5 p-3.5")}>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{title}</span>
          {busy ? (
            <Spinner size="sm" className="text-muted-foreground" />
          ) : (
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-enabled:group-hover:translate-x-0.5 group-enabled:group-hover:text-foreground"
            />
          )}
        </span>
        <span id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}
