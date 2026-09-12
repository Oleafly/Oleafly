import * as React from "react";
import { useTranslation } from "react-i18next";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { format, isValid, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

export function isoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function parseIsoDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : undefined;
}

export interface DatePickerProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  className?: string;
  buttonClassName?: string;
  align?: "start" | "center" | "end";
  displayFormat?: string;
  clearable?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  id,
  disabled,
  min,
  max,
  className,
  buttonClassName,
  align = "start",
  displayFormat = "MMM d, yyyy",
  clearable = false,
  ...rest
}: Readonly<DatePickerProps>) {
  const { t } = useTranslation(["common", "shell"]);
  const [open, setOpen] = React.useState(false);
  const selected = parseIsoDate(value);
  const minDate = parseIsoDate(min);
  const maxDate = parseIsoDate(max);
  const disabledMatchers = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={rest["aria-label"]}
          data-testid={rest["data-testid"]}
          data-empty={!selected}
          className={cn(
            "h-9 w-full justify-start gap-2 px-3 text-left font-normal data-[empty=true]:text-muted-foreground",
            buttonClassName,
          )}
        >
          <CalendarIcon className="size-4 shrink-0 opacity-60" />
          <span className="truncate">
            {selected
              ? format(selected, displayFormat)
              : (placeholder ?? t(($) => $.shell.datePicker.placeholder))}
          </span>
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={6}
          className={cn(
            "z-[70] w-auto rounded-lg border bg-popover p-0 text-popover-foreground shadow-md outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            className,
          )}
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? maxDate ?? undefined}
            disabled={disabledMatchers.length > 0 ? disabledMatchers : undefined}
            onSelect={(date) => {
              if (!date) {
                if (clearable) onChange(null);
                return;
              }
              onChange(isoDate(date));
              setOpen(false);
            }}
            autoFocus
          />
          {clearable && selected && (
            <div className="border-t px-3 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                {t(($) => $.common.actions.clear)}
              </Button>
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
