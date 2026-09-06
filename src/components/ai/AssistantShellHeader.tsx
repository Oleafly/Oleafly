import { createContext, useContext, useMemo, type HTMLAttributes, type ReactNode } from "react";
import { PanelRightOpen } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/store/settings";
import { cn } from "@/lib/utils";

interface AssistantShellValue {
  leading: ReactNode;
}

const AssistantShellContext = createContext<AssistantShellValue | null>(null);

export function AssistantShellProvider({
  leading,
  children,
}: {
  leading: ReactNode;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ leading }), [leading]);
  return <AssistantShellContext.Provider value={value}>{children}</AssistantShellContext.Provider>;
}

export function useAssistantShellLeading(): ReactNode {
  return useContext(AssistantShellContext)?.leading ?? null;
}

export function AssistantShellHeader({
  leading,
  actions,
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn("flex h-9 shrink-0 items-center gap-1.5 border-b px-2", className)}
      {...rest}
    >
      {leading}
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>
    </div>
  );
}

export function AssistantFloatButton({ disabled }: { disabled?: boolean }) {
  const chatFloating = useSettingsStore((state) => state.chatFloating);
  const setChatFloating = useSettingsStore((state) => state.setChatFloating);
  if (chatFloating) return null;
  return (
    <Tooltip label="Float the assistant">
      <button
        type="button"
        aria-label="Float the assistant over the app"
        data-testid="ai-chat-float"
        disabled={disabled}
        onClick={() => setChatFloating(true)}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <PanelRightOpen className="size-3.5" />
      </button>
    </Tooltip>
  );
}
