import type { TFunction } from "i18next";
import { type ComponentProps, createContext, useCallback, useContext, useMemo, useState } from "react";
import { type DayButtonProps, type MonthCaptionProps, useDayPicker, type WeekNumberProps } from "react-day-picker";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { MonthPicker } from "@/components/ui/month-picker";
import { PopoverItem } from "@/components/ui/popover";
import { type NotesPeriodic, type PeriodicKind, periodTitle, type WeekDay, weekNumber } from "@/lib/notes-periodic";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";
import { type OpenPeriodicNote, pickPeriodic, titledNotes, useNotesWeekStart, useOpenPeriodicNote } from "./daily-note";
import { taskEntries } from "./note-task-list";
import { localDate } from "./note-templates";
import { useNoteTasks, useNotesData } from "./notes-data";
import type { NoteItem } from "./types";

type CalendarComponents = NonNullable<ComponentProps<typeof Calendar>["components"]>;

export interface CalendarMarks {
  daily: (date: Date) => NoteItem | undefined;
  weekly: (date: Date) => NoteItem | undefined;
  monthly: (date: Date) => NoteItem | undefined;
  due: ReadonlyMap<string, number>;
}

interface ComponentInputs {
  marks: CalendarMarks;
  can: (kind: PeriodicKind, date: Date) => boolean;
  open: OpenPeriodicNote;
  t: TFunction<["notes"]>;
  locale: string;
  first: WeekDay;
}

interface CaptionInputs {
  monthly: CalendarMarks["monthly"];
  can: ComponentInputs["can"];
  open: OpenPeriodicNote;
}

const CaptionContext = createContext<CaptionInputs>({ monthly: () => undefined, can: () => false, open: () => undefined });

const TODAY = "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground focus-visible:bg-primary/85 focus-visible:text-primary-foreground";

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function atTimeOfDay(date: Date, now: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), now.getHours(), now.getMinutes());
}

function useCalendarMarks(settings: NotesPeriodic, locale: string): CalendarMarks {
  const data = useNotesData();
  const tasks = useNoteTasks();
  const byTitle = useMemo(() => titledNotes(data.notes), [data.notes]);
  const due = useMemo(() => {
    const counts = new Map<string, number>();
    if (!tasks.data) return counts;
    for (const entry of taskEntries(tasks.data, data.notes)) {
      if (!entry.checked && entry.due) counts.set(entry.due, (counts.get(entry.due) ?? 0) + 1);
    }
    return counts;
  }, [data.notes, tasks.data]);
  return useMemo(() => {
    const find = (kind: PeriodicKind) => (date: Date) => pickPeriodic(byTitle.get(periodTitle(kind, settings, date, locale)), settings[kind].tag);
    return { daily: find("daily"), weekly: find("weekly"), monthly: find("monthly"), due };
  }, [byTitle, due, locale, settings]);
}

function calendarComponents({ marks, can, open, t, locale, first: weekFirst }: ComponentInputs): CalendarComponents {
  const dayLabel = new Intl.DateTimeFormat(locale, { dateStyle: "full" });
  return {
    DayButton: ({ day, modifiers, className, children, ...props }: DayButtonProps) => {
      const note = marks.daily(day.date);
      const due = marks.due.get(localDate(day.date)) ?? 0;
      const parts = [dayLabel.format(day.date)];
      if (note) parts.push(t(($) => $.notes.calendar.hasNote));
      if (due > 0) parts.push(t(($) => $.notes.calendar.due, { count: due }));
      return (
        <button
          {...props}
          type="button"
          className={cn(className, "relative", modifiers.today && TODAY)}
          aria-label={parts.join(", ")}
          data-day-note={note ? "true" : undefined}
          data-day-due={due > 0 ? due : undefined}
        >
          {children}
          <span aria-hidden className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5">
            {note && <span className={cn("size-1 rounded-full", modifiers.today ? "bg-primary-foreground" : "bg-primary")} data-mark="note" />}
            {due > 0 && (
              <span
                className={cn("size-1 rounded-full border", modifiers.today ? "border-primary-foreground" : "border-amber-500 dark:border-amber-400")}
                data-mark="due"
              />
            )}
          </span>
        </button>
      );
    },
    WeekNumber: ({ week, className, ...props }: WeekNumberProps) => {
      const first = week.days[0]?.date;
      const exists = first ? marks.weekly(first) !== undefined : false;
      const number = first ? weekNumber(first, weekFirst).week : week.weekNumber;
      return (
        <th {...props} scope="row" className={cn(className, "w-8 p-0 text-center align-middle")}>
          {first && can("weekly", first) ? (
            <Button
              variant="ghost"
              size="xs"
              aria-label={t(($) => $.notes.calendar.openWeek, { week: number })}
              data-week={number}
              data-week-note={exists ? "true" : undefined}
              className={cn("size-8 p-0 text-[0.7rem] font-normal text-muted-foreground", exists && "font-semibold text-primary")}
              onClick={() => open("weekly", first)}
            >
              {number}
            </Button>
          ) : (
            <span className="text-[0.7rem] text-muted-foreground/70">{number}</span>
          )}
        </th>
      );
    },
    MonthCaption: NotesMonthCaption,
  };
}

function NotesMonthCaption({ calendarMonth, displayIndex: _index, ...props }: MonthCaptionProps) {
  const { t, i18n } = useTranslation(["notes"]);
  const { goToMonth } = useDayPicker();
  const { monthly, can, open } = useContext(CaptionContext);
  const date = calendarMonth.date;
  const thisMonth = startOfMonth(new Date());
  const elsewhere = date.getTime() !== thisMonth.getTime();
  const openable = can("monthly", date);
  return (
    <div {...props}>
      <MonthPicker month={date} onMonthChange={goToMonth} locale={i18n.language}>
        {(openable || elsewhere) && (
          <>
            {openable && (
              <PopoverItem onClick={() => open("monthly", date)}>
                {monthly(date) ? t(($) => $.notes.calendar.openMonthNote) : t(($) => $.notes.calendar.createMonthNote)}
              </PopoverItem>
            )}
            {elsewhere && <PopoverItem onClick={() => goToMonth(thisMonth)}>{t(($) => $.notes.calendar.today)}</PopoverItem>}
          </>
        )}
      </MonthPicker>
    </div>
  );
}

export function NotesCalendar({ onOpenNote }: Readonly<{ onOpenNote: (id: string) => void }>) {
  const { t, i18n } = useTranslation(["notes"]);
  const locale = i18n.language;
  const settings = useSettingsStore((state) => state.notesPeriodic);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const marks = useCalendarMarks(settings, locale);
  const open = useOpenPeriodicNote(onOpenNote);
  const first = useNotesWeekStart();
  const { createNoteFrom } = useNotesData();
  const can = useCallback(
    (kind: PeriodicKind, date: Date) => marks[kind](date) !== undefined || (settings[kind].enabled && createNoteFrom !== undefined),
    [createNoteFrom, marks, settings],
  );
  const components = useMemo(() => calendarComponents({ marks, can, open, t, locale, first }), [can, first, locale, marks, open, t]);
  const caption = useMemo(() => ({ monthly: marks.monthly, can, open }), [can, marks.monthly, open]);
  const thisMonth = startOfMonth(new Date());

  return (
    <div data-notes-calendar className="flex flex-col items-center">
      <CaptionContext.Provider value={caption}>
        <Calendar
          month={month}
          onMonthChange={setMonth}
          weekStartsOn={first}
          ISOWeek={first === 1}
          showWeekNumber
          fixedWeeks
          labels={{ labelWeekNumberHeader: () => t(($) => $.notes.calendar.week) }}
          disabled={(date) => !can("daily", date)}
          onDayClick={(date, modifiers) => {
            if (!modifiers.disabled) open("daily", atTimeOfDay(date, new Date()));
          }}
          components={components}
          className="p-1"
          classNames={{ week_number_header: "w-8 text-[0.7rem] font-normal text-muted-foreground", week_number: "w-8", today: "" }}
        />
      </CaptionContext.Provider>
      <div data-calendar-today className="flex h-5 w-full items-center justify-end px-2">
        {month.getTime() !== thisMonth.getTime() && (
          <Button variant="link" size="xs" className="h-auto p-0" onClick={() => setMonth(thisMonth)}>
            {t(($) => $.notes.calendar.today)}
          </Button>
        )}
      </div>
    </div>
  );
}
