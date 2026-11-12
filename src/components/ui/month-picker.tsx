import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const MONTHS = Array.from({ length: 12 }, (_, index) => index);

export interface MonthPickerProps {
  month: Date;
  onMonthChange: (month: Date) => void;
  locale?: string;
  children?: ReactNode;
}

export function MonthPicker({ month, onMonthChange, locale, children }: Readonly<MonthPickerProps>) {
  const { t, i18n } = useTranslation(["shell"]);
  const [year, setYear] = useState(month.getFullYear());
  const shown = useRef<HTMLButtonElement>(null);
  const language = locale ?? i18n.language;
  const short = new Intl.DateTimeFormat(language, { month: "short" });
  const long = new Intl.DateTimeFormat(language, { month: "long", year: "numeric" });
  const now = new Date();
  return (
    <Popover
      trigger={
        <>
          {long.format(month)}
          <ChevronDown aria-hidden className="opacity-60" />
        </>
      }
      triggerClassName="h-7 gap-1 px-2 text-sm font-medium"
      contentAriaLabel={t(($) => $.shell.monthPicker.label)}
      className="w-56 p-2"
      closeOnClick={false}
      onOpenChange={(open) => {
        if (open) setYear(month.getFullYear());
      }}
      onOpenAutoFocus={(event) => {
        if (!shown.current) return;
        event.preventDefault();
        shown.current.focus();
      }}
    >
      <div className="flex items-center justify-between pb-1">
        <Button variant="ghost" size="icon" className="size-7" aria-label={t(($) => $.shell.monthPicker.previousYear)} onClick={() => setYear(year - 1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <span aria-live="polite" className="text-sm font-medium tabular-nums">
          {year}
        </span>
        <Button variant="ghost" size="icon" className="size-7" aria-label={t(($) => $.shell.monthPicker.nextYear)} onClick={() => setYear(year + 1)}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTHS.map((index) => {
          const date = new Date(year, index, 1);
          const isShown = year === month.getFullYear() && index === month.getMonth();
          const isCurrent = year === now.getFullYear() && index === now.getMonth();
          return (
            <PopoverClose asChild key={index}>
              <Button
                ref={isShown ? shown : undefined}
                variant={isCurrent ? "default" : "ghost"}
                size="sm"
                aria-label={long.format(date)}
                aria-current={isCurrent ? "date" : undefined}
                data-shown={isShown ? "true" : undefined}
                className={cn("text-sm font-normal", isShown && !isCurrent && "bg-accent font-medium text-accent-foreground")}
                onClick={() => onMonthChange(date)}
              >
                {short.format(date)}
              </Button>
            </PopoverClose>
          );
        })}
      </div>
      {children && <div className="mt-2 border-t pt-1">{children}</div>}
    </Popover>
  );
}
