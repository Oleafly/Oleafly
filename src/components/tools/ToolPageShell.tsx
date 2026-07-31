import type { ComponentType, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, isMac } from "@/lib/utils";
import { WindowControls } from "@/components/layout/WindowControls";
import { useFullscreen } from "@/lib/use-fullscreen";
import { useHomeViewStore, type HomePage } from "@/store/home-view";

export function ToolPageShell({
  page,
  title,
  subtitle,
  icon: Icon,
  actions,
  testId,
  children,
}: {
  page: HomePage;
  title: string;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  actions?: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  const activePage = useHomeViewStore((s) => s.page);
  const goTo = useHomeViewStore((s) => s.goTo);
  const fullscreen = useFullscreen();
  if (activePage !== page) return null;
  return (
    <div data-testid={testId} className="flex h-full flex-col bg-background">
      <div
        data-tauri-drag-region
        className={cn(
          "flex items-center gap-3 border-b px-4 py-2.5",
          isMac && !fullscreen && "pl-20",
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => goTo("library")}
          data-testid={`${testId}-back`}
        >
          <ArrowLeft className="size-4" /> Back
        </Button>
        <div className="h-6 w-px bg-border" />
        {Icon && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
            <Icon className="size-4" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{title}</div>
          {subtitle && (
            <div className="hidden text-xs leading-tight text-muted-foreground sm:block">
              {subtitle}
            </div>
          )}
        </div>
        <div className="flex-1" />
        {actions}
        <WindowControls />
      </div>
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  );
}
