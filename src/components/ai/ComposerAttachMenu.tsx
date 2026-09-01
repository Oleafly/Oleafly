import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ComposerCommand } from "./composer-command-registry";

export function ComposerAttachMenu({ commands }: { commands: ComposerCommand[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-tour="ai-attachments"
          type="button"
          aria-label="Add context"
          title="Add context"
          className="ai-composer-attach flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="z-[80] w-72"
        onCloseAutoFocus={(event) => {
          const active = document.activeElement;
          const menu = event.currentTarget;
          if (
            active &&
            active !== document.body &&
            menu instanceof HTMLElement &&
            !menu.contains(active)
          ) {
            event.preventDefault();
          }
        }}
      >
        <DropdownMenuLabel>Add context</DropdownMenuLabel>
        {commands.map((command) => (
          <DropdownMenuItem
            key={command.id}
            onSelect={command.action}
            className="items-start gap-2.5 px-2.5 py-2"
          >
            <command.icon className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium leading-snug">{command.label}</span>
              <span className="block text-[11px] leading-snug text-muted-foreground">
                {command.description}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
