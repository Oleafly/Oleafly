import { Search, X } from "lucide-react";
import { type RefObject, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  clearLabel,
  clearOnEscape = false,
  inputRef,
  className,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  clearLabel?: string;
  clearOnEscape?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}>) {
  const { t } = useTranslation(["workspace"]);
  const inputId = useId();
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const clear = clearLabel ?? t(($) => $.workspace.tree.clearFilter);
  return (
    <div className={cn("relative block rounded-md", className)}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        id={inputId}
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (!clearOnEscape || event.key !== "Escape" || value === "" || isImeEnter(event)) return;
          event.preventDefault();
          event.stopPropagation();
          onChange("");
        }}
        placeholder={placeholder ?? t(($) => $.workspace.tree.filterPlaceholder)}
        className="h-7 w-full rounded-md border border-input bg-background/70 pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground/75 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <Tooltip label={clear} side="bottom" className="absolute right-0 top-1/2 -translate-y-1/2">
          <button
            type="button"
            aria-label={clear}
            onClick={() => {
              onChange("");
              ref.current?.focus();
            }}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
          >
            <X aria-hidden className="size-3" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
