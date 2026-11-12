import { ChevronDown, ChevronRight, ChevronUp, Search, X } from "lucide-react";
import { type ComponentProps, type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";

const ICON = "shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-3.5";
const PRESSED = "bg-primary/20 text-foreground hover:bg-primary/25";
const BOX = "flex min-w-0 flex-1 items-center gap-0.5 rounded-md border bg-background pl-1.5 focus-within:border-ring";
const FIELD = "h-7 w-44 min-w-14 flex-1 border-0 bg-transparent px-1 py-0 text-xs shadow-none";

export interface FindBarToggle {
  label: string;
  glyph: ReactNode;
  pressed: boolean;
  onToggle(): void;
  className?: string;
}

export interface FindBarAction {
  label: string;
  text: string;
  onClick(): void;
}

export interface FindBarReplace {
  open: boolean;
  onOpenChange(open: boolean): void;
  toggleLabel: string;
  value: string;
  onValueChange(value: string): void;
  label: string;
  toggles?: readonly FindBarToggle[];
  onEnter(): void;
  actions: readonly FindBarAction[];
}

export type FindBarProps = Readonly<
  {
    value: string;
    onValueChange(value: string): void;
    inputLabel: string;
    placeholder?: string;
    inputRef?: RefObject<HTMLInputElement | null>;
    focusOnMount?: boolean;
    status: ReactNode;
    stepDisabled?: boolean;
    onStep(forward: boolean): void;
    onClose(): void;
    labels: Readonly<{ previous: string; next: string; close: string }>;
    toggles?: readonly FindBarToggle[];
    replace?: FindBarReplace;
  } & Omit<ComponentProps<"div">, "role" | "children">
>;

function keepFocus(event: { preventDefault(): void }) {
  event.preventDefault();
}

function fieldKeys(onEnter: (shift: boolean) => void, onClose: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeEnter(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onEnter(event.shiftKey);
    }
  };
}

function Toggles({ toggles }: Readonly<{ toggles?: readonly FindBarToggle[] }>) {
  return toggles?.map((toggle) => (
    <TooltipIconButton
      key={toggle.label}
      label={toggle.label}
      aria-pressed={toggle.pressed}
      onMouseDown={keepFocus}
      onClick={toggle.onToggle}
      className={cn(ICON, toggle.pressed && PRESSED, toggle.className)}
    >
      {toggle.glyph}
    </TooltipIconButton>
  ));
}

export function FindBar({
  value,
  onValueChange,
  inputLabel,
  placeholder = inputLabel,
  inputRef,
  focusOnMount,
  status,
  stepDisabled,
  onStep,
  onClose,
  labels,
  toggles,
  replace,
  className,
  ...rest
}: FindBarProps) {
  const ownRef = useRef<HTMLInputElement>(null);
  const findRef = inputRef ?? ownRef;
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceId = useId();

  useEffect(() => {
    if (focusOnMount) findRef.current?.focus();
  }, [findRef, focusOnMount]);

  const step = (forward: boolean, icon: ReactNode, label: string) => (
    <TooltipIconButton label={label} disabled={stepDisabled} onMouseDown={keepFocus} onClick={() => onStep(forward)} className={ICON}>
      {icon}
    </TooltipIconButton>
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: WebKit before Safari 17 has no search element, so the role keeps the landmark
    <div
      role="search"
      {...rest}
      className={cn("flex w-fit items-start gap-1 rounded-lg border bg-popover p-1.5 text-xs text-popover-foreground shadow-xl", className)}
    >
      {replace && (
        <TooltipIconButton
          label={replace.toggleLabel}
          aria-expanded={replace.open}
          aria-controls={replaceId}
          onMouseDown={keepFocus}
          onClick={() => {
            replace.onOpenChange(!replace.open);
            if (!replace.open) requestAnimationFrame(() => replaceRef.current?.focus({ preventScroll: true }));
          }}
          className={cn(ICON, "w-5 min-w-5")}
        >
          {replace.open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        </TooltipIconButton>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <div className={BOX}>
            <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              ref={findRef}
              value={value}
              spellCheck={false}
              placeholder={placeholder}
              aria-label={inputLabel}
              onChange={(event) => onValueChange(event.target.value)}
              onKeyDown={fieldKeys((shift) => onStep(!shift), onClose)}
              className={FIELD}
            />
            <Toggles toggles={toggles} />
          </div>
          <output aria-live="polite" aria-atomic="true" className="min-w-[3.25rem] shrink-0 px-1 text-center text-[0.6875rem] tabular-nums text-muted-foreground">
            {status}
          </output>
          {step(false, <ChevronUp aria-hidden />, labels.previous)}
          {step(true, <ChevronDown aria-hidden />, labels.next)}
          <TooltipIconButton label={labels.close} onMouseDown={keepFocus} onClick={onClose} className={ICON}>
            <X aria-hidden />
          </TooltipIconButton>
        </div>
        {replace?.open && (
          <div id={replaceId} className="flex min-w-0 items-center gap-1">
            <div className={BOX}>
              <Input
                ref={replaceRef}
                value={replace.value}
                spellCheck={false}
                placeholder={replace.label}
                aria-label={replace.label}
                onChange={(event) => replace.onValueChange(event.target.value)}
                onKeyDown={fieldKeys(replace.onEnter, onClose)}
                className={FIELD}
              />
              <Toggles toggles={replace.toggles} />
            </div>
            {replace.actions.map((action) => (
              <Tooltip key={action.label} label={action.label} side="bottom">
                <Button type="button" variant="ghost" size="xs" className="h-7 text-muted-foreground hover:text-foreground" onMouseDown={keepFocus} onClick={action.onClick}>
                  {action.text}
                </Button>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
