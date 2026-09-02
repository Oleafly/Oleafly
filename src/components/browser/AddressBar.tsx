import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  ExternalLink,
  Loader2,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import type { BrowserTab } from "./browser-state";
import type { OverlayGate } from "./use-overlay-gate";

export const ADDRESS_FIELD_LABEL = "Search or enter a URL";

interface AddressBarProps {
  tab: BrowserTab | null;
  gate: OverlayGate;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSubmit: (input: string) => void;
  onOpenExternal: () => void;
  onCopyUrl: () => void;
  onSetHomePage: () => void;
  onNewTab: () => void;
  addressRef: React.RefObject<HTMLInputElement | null>;
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label} side="top">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="size-8 text-muted-foreground hover:text-foreground"
      >
        {children}
      </Button>
    </Tooltip>
  );
}

export function AddressBar({
  tab,
  gate,
  onBack,
  onForward,
  onReload,
  onSubmit,
  onOpenExternal,
  onCopyUrl,
  onSetHomePage,
  onNewTab,
  addressRef,
}: AddressBarProps) {
  const url = tab?.url ?? "";
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(url);
  }, [url]);

  const startEditing = () => {
    editingRef.current = true;
    setEditing(true);
  };
  const stopEditing = () => {
    editingRef.current = false;
    setEditing(false);
    setDraft(url);
  };

  const hasTab = tab !== null;
  const loading = tab?.loading ?? false;

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-1 border-b border-border bg-background px-2">
      <ToolButton label="Back" onClick={onBack} disabled={!hasTab}>
        <ArrowLeft className="size-4" aria-hidden />
      </ToolButton>
      <ToolButton label="Forward" onClick={onForward} disabled={!hasTab}>
        <ArrowRight className="size-4" aria-hidden />
      </ToolButton>
      <ToolButton label="Reload" onClick={onReload} disabled={!hasTab}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden data-testid="browser-loading" />
        ) : (
          <RotateCw className="size-4" aria-hidden />
        )}
      </ToolButton>
      <form
        className="flex min-w-0 flex-1 items-center px-1"
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft;
          editingRef.current = false;
          setEditing(false);
          onSubmit(value);
          addressRef.current?.blur();
        }}
      >
        <Input
          ref={addressRef}
          type="text"
          aria-label={ADDRESS_FIELD_LABEL}
          placeholder={ADDRESS_FIELD_LABEL}
          value={editing ? draft : url}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-busy={loading || undefined}
          onFocus={(event) => {
            startEditing();
            setDraft(url);
            event.currentTarget.select();
          }}
          onBlur={stopEditing}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              stopEditing();
              event.currentTarget.blur();
            }
          }}
          className="h-8 rounded-full bg-muted/50 px-4 text-sm focus-visible:bg-background"
        />
      </form>
      <ToolButton label="Open in your browser" onClick={onOpenExternal} disabled={!url}>
        <ExternalLink className="size-4" aria-hidden />
      </ToolButton>
      <DropdownMenu open={gate.open} onOpenChange={gate.setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="More options"
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6}>
          <DropdownMenuItem onSelect={onNewTab}>New tab</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!url} onSelect={onCopyUrl}>
            Copy URL
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!url} onSelect={onSetHomePage}>
            Set as home page
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!url} onSelect={onOpenExternal}>
            Open in your browser
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
