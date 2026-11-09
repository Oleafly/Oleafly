import { Command } from "cmdk";
import type { ComponentProps, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

export const COMMAND_ITEM =
  "flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";
export const COMMAND_GROUP =
  "px-1 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5";

type DialogProps = Omit<ComponentProps<typeof Command.Dialog>, "children" | "className" | "overlayClassName">;

export interface CommandDialogShellProps extends DialogProps {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  placement?: string;
  listRef?: Ref<HTMLDivElement>;
  listClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
}

export function CommandDialogShell({
  query,
  onQueryChange,
  placeholder,
  placement = "top-[20%]",
  listRef,
  listClassName = "max-h-[min(60vh,360px)]",
  footer,
  children,
  ...dialog
}: Readonly<CommandDialogShellProps>) {
  return (
    <Command.Dialog
      {...dialog}
      overlayClassName="fixed inset-0 z-[90] bg-black/55 backdrop-blur-sm motion-reduce:backdrop-blur-none"
      className={cn("fixed left-1/2 z-[90] w-[min(560px,92vw)] -translate-x-1/2", placement)}
    >
      <div className="overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
        <Command.Input
          value={query}
          onValueChange={onQueryChange}
          autoFocus
          placeholder={placeholder}
          className="flex h-12 w-full border-b border-border bg-transparent px-4 text-sm placeholder:text-muted-foreground"
        />
        <Command.List ref={listRef} className={cn("overflow-auto p-1.5", listClassName)}>
          {children}
        </Command.List>
        {footer}
      </div>
    </Command.Dialog>
  );
}
