import { MessageSquareQuote, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { WorkspaceBanner } from "@/components/ui/workspace-banner";
import { cn, isMac, modKey } from "@/lib/utils";

export const COMMENT_SHORTCUT = [modKey, isMac ? "⌥" : "Alt", "M"] as const;
export const KEYS_SLOT = "{keys}";

export function CommentKeys({ keys = COMMENT_SHORTCUT }: Readonly<{ keys?: readonly string[] }>) {
  return (
    <KbdGroup className="mx-0.5 align-middle">
      {keys.map((key) => (
        <Kbd key={key} className="h-4 min-w-4 px-1 text-[0.625rem]">
          {key}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

export function withKeys(text: string, keys: ReactNode): ReactNode {
  const at = text.indexOf(KEYS_SLOT);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      {keys}
      {text.slice(at + KEYS_SLOT.length)}
    </>
  );
}

export function CommentsEmpty({
  title,
  description,
  className,
}: Readonly<{ title: ReactNode; description?: ReactNode; className?: string }>) {
  return (
    <EmptyState
      size="compact"
      className={cn("px-4 py-6", className)}
      icon={
        <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
          <MessageSquareQuote aria-hidden className="size-4" />
        </span>
      }
      title={title}
      description={description}
    />
  );
}

export function CommentsFootnote({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="border-t border-sidebar-border px-3 py-2 text-[0.6875rem] text-muted-foreground">{children}</p>;
}

export function CommentsOfflineQueue({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <WorkspaceBanner tone="neutral" role="status" data-testid="comments-offline-queue">
      <WifiOff aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">{children}</p>
    </WorkspaceBanner>
  );
}
