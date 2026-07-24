import { Home } from "lucide-react";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { cn } from "@/lib/utils";

export function HomeBrandButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Home"
      title="Back to library"
      className={cn(
        "group flex items-center gap-1.5 rounded px-1.5 py-1 text-sm font-semibold tracking-tight hover:bg-accent",
        className
      )}
    >
      <span className="flex items-center gap-1.5 group-hover:hidden">
        <LeafLogo className="size-5" />
        Oleafly
      </span>
      <span className="hidden items-center gap-1.5 group-hover:flex">
        <Home className="size-5" />
        Home
      </span>
    </button>
  );
}
