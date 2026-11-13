import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const LISTBOX_CLASS = "overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl";

export function Listbox({ className, ...props }: Readonly<Omit<ComponentProps<"div">, "role">>) {
  return <div role="listbox" {...props} className={cn(LISTBOX_CLASS, className)} />;
}

export function ListboxOption({
  selected,
  onHighlight,
  onChoose,
  className,
  ...props
}: Readonly<
  { selected: boolean; onHighlight?: () => void; onChoose: () => void } & Omit<
    ComponentProps<"button">,
    "role" | "type" | "onClick" | "onMouseEnter" | "onMouseDown" | "tabIndex"
  >
>) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      {...props}
      onMouseEnter={() => {
        if (!selected) onHighlight?.();
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChoose}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors motion-reduce:transition-none",
        selected && "bg-accent text-accent-foreground",
        className,
      )}
    />
  );
}

export function ListboxHeading({ separated, className, ...props }: Readonly<{ separated?: boolean } & ComponentProps<"p">>) {
  return (
    <p
      {...props}
      className={cn(
        "px-2.5 pb-1 pt-1.5 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground",
        separated && "mt-1 border-t pt-2",
        className,
      )}
    />
  );
}
