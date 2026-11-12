import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  cleanTag,
  localeWeekStart,
  resolveWeekStart,
  weekNumber,
  formatPeriodTitle,
  isoWeek,
  NOTES_PERIODIC_DEFAULTS,
  normalizePeriodic,
  parseDayTitle,
  periodStart,
  periodTitle,
  readPeriodic,
  startOfDay,
  validPeriodFormat,
  weekdayName,
  weekStart,
} from "./notes-periodic";

const WED = new Date(2026, 10, 11, 15, 30);

afterEach(() => vi.unstubAllGlobals());

describe("period titles", () => {
  it("writes the default daily, weekly and monthly titles", () => {
    expect(periodTitle("daily", NOTES_PERIODIC_DEFAULTS, WED, "en")).toBe("2026-11-11");
    expect(periodTitle("weekly", NOTES_PERIODIC_DEFAULTS, WED, "en-GB")).toBe("2026-W46");
    expect(periodTitle("monthly", NOTES_PERIODIC_DEFAULTS, WED, "en")).toBe("2026-11");
  });

  it("formats names, short forms and literals in the reader's language", () => {
    expect(formatPeriodTitle("dddd, D MMMM YYYY", WED, "en")).toBe("Wednesday, 11 November 2026");
    expect(formatPeriodTitle("ddd D MMM YY", WED, "en")).toBe("Wed 11 Nov 26");
    expect(formatPeriodTitle("MMMM YYYY", WED, "de")).toBe("November 2026");
    expect(formatPeriodTitle("[Week] W [of] GGGG, Q[Q]", WED, "en")).toBe("Week 46 of 2026, 4Q");
    expect(formatPeriodTitle("M/D/YYYY", new Date(2026, 0, 5), "en")).toBe("1/5/2026");
    expect(formatPeriodTitle("GG-w-d", new Date(2027, 0, 2), "en")).toBe("26-53-6");
  });

  it("keeps unclosed and stray brackets as text and reads the first closing bracket", () => {
    expect(formatPeriodTitle("[YYYY", WED, "en")).toBe("[2026");
    expect(formatPeriodTitle("YYYY] [[a]", WED, "en")).toBe("2026] [a");
    expect(formatPeriodTitle("[a[b]c]", WED, "en")).toBe("a[bc]");
    expect(validPeriodFormat("[YYYY")).toBe(true);
    expect(validPeriodFormat("[YYYY]")).toBe(false);
    expect(validPeriodFormat("[".repeat(100_000))).toBe(false);
  });

  it("numbers weeks the ISO way across year ends", () => {
    expect(isoWeek(new Date(2026, 0, 1))).toEqual({ year: 2026, week: 1 });
    expect(isoWeek(new Date(2025, 11, 29))).toEqual({ year: 2026, week: 1 });
    expect(isoWeek(new Date(2026, 11, 31))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(new Date(2027, 0, 3))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(new Date(2027, 0, 4))).toEqual({ year: 2027, week: 1 });
    expect(formatPeriodTitle("GGGG-[W]WW", new Date(2027, 0, 2), "en")).toBe("2026-W53");
  });

  it("starts weeks on Monday and months on the first", () => {
    expect(weekStart(WED)).toEqual(new Date(2026, 10, 9));
    expect(weekStart(new Date(2026, 10, 15))).toEqual(new Date(2026, 10, 9));
    expect(periodStart("monthly", WED)).toEqual(new Date(2026, 10, 1));
    expect(periodStart("daily", WED)).toEqual(new Date(2026, 10, 11));
  });
});

describe("week starts", () => {
  it("follows the language and region unless a day is picked", () => {
    expect(localeWeekStart("en-US")).toBe(0);
    expect(localeWeekStart("en-GB")).toBe(1);
    expect(localeWeekStart("de")).toBe(1);
    expect(localeWeekStart("ar-EG")).toBe(6);
    expect(localeWeekStart("not a locale")).toBe(1);
    expect(resolveWeekStart("locale", "ja")).toBe(0);
    expect(resolveWeekStart("monday", "en-US")).toBe(1);
    expect(resolveWeekStart("sunday", "de")).toBe(0);
    expect(resolveWeekStart("saturday", "de")).toBe(6);
  });

  it("takes the region from the system when the interface language has none", () => {
    expect(localeWeekStart("en", ["en-GB"])).toBe(1);
    expect(localeWeekStart("en", ["de-DE", "en-AU", "en-US"])).toBe(1);
    expect(localeWeekStart("en", ["en-US"])).toBe(0);
    expect(localeWeekStart("en", ["de-DE"])).toBe(0);
    expect(localeWeekStart("en-US", ["en-GB"])).toBe(0);
    expect(localeWeekStart("en", ["not a locale"])).toBe(0);
  });

  it("reads the system region from the browser for the locale setting", () => {
    vi.stubGlobal("navigator", { language: "en-IE", languages: ["en-IE"] });
    expect(resolveWeekStart("locale", "en")).toBe(1);
    expect(periodTitle("weekly", NOTES_PERIODIC_DEFAULTS, new Date(2027, 0, 4), "en")).toBe("2027-W01");
    vi.stubGlobal("navigator", { language: "en-US", languages: [] });
    expect(resolveWeekStart("locale", "en")).toBe(0);
  });

  it("starts weeks on the chosen day and numbers them from the week with January 1", () => {
    expect(weekStart(WED, 0)).toEqual(new Date(2026, 10, 8));
    expect(weekStart(WED, 6)).toEqual(new Date(2026, 10, 7));
    expect(weekNumber(WED, 0)).toEqual({ year: 2026, week: 46 });
    expect(weekNumber(new Date(2026, 0, 1), 0)).toEqual({ year: 2026, week: 1 });
    expect(weekNumber(new Date(2025, 11, 28), 0)).toEqual({ year: 2026, week: 1 });
    expect(weekNumber(new Date(2026, 11, 26), 0)).toEqual({ year: 2026, week: 52 });
    expect(weekNumber(new Date(2026, 11, 27), 0)).toEqual({ year: 2027, week: 1 });
    expect(weekNumber(WED, 1)).toEqual(isoWeek(WED));
    expect(formatPeriodTitle("GGGG-[W]WW", new Date(2026, 10, 8), "en", 0)).toBe("2026-W46");
    expect(periodTitle("weekly", { ...NOTES_PERIODIC_DEFAULTS, weekStart: "sunday" }, WED, "de")).toBe("2026-W46");
    expect(periodTitle("weekly", { ...NOTES_PERIODIC_DEFAULTS, weekStart: "monday" }, new Date(2026, 10, 8), "en-US")).toBe("2026-W45");
  });
});

describe("day helpers", () => {
  it("drops the time and moves by calendar days across a clock change", () => {
    expect(startOfDay(WED)).toEqual(new Date(2026, 10, 11));
    expect(addDays(new Date(2026, 2, 28, 23, 30), 2)).toEqual(new Date(2026, 2, 30));
    expect(addDays(WED, -11)).toEqual(new Date(2026, 9, 31));
  });

  it("names a weekday from Sunday as 0", () => {
    expect(weekdayName(0, "en")).toBe("Sunday");
    expect(weekdayName(1, "de")).toBe("Montag");
  });
});

describe("reading a day back from its title", () => {
  it.each([
    ["YYYY-MM-DD", "2026-11-11"],
    ["DD.MM.YYYY", "11.11.2026"],
    ["dddd, D MMMM YYYY", "Wednesday, 11 November 2026"],
    ["[Journal] YY-M-D", "Journal 26-11-11"],
    ["ddd D MMM YYYY", "Wed 11 Nov 2026"],
    ["[Week] W: YYYY-MM-DD", "Week 46: 2026-11-11"],
  ])("reads %s", (format, title) => {
    expect(parseDayTitle(format, title, "en")).toEqual(new Date(2026, 10, 11));
  });

  it("refuses titles that do not fit or name an impossible day", () => {
    expect(parseDayTitle("YYYY-MM-DD", "2026-02-30", "en")).toBeNull();
    expect(parseDayTitle("YYYY-MM-DD", "Idea", "en")).toBeNull();
    expect(parseDayTitle("dddd, D MMMM YYYY", "Monday, 11 November 2026", "en")).toBeNull();
    expect(parseDayTitle("GGGG-[W]WW", "2026-W46", "en")).toBeNull();
  });
});

describe("periodic note settings", () => {
  it("needs at least one date part in a format", () => {
    expect(validPeriodFormat("YYYY")).toBe(true);
    expect(validPeriodFormat("[Week]")).toBe(false);
    expect(validPeriodFormat("  ")).toBe(false);
  });

  it("keeps good values and falls back for the rest", () => {
    const settings = normalizePeriodic({
      daily: { enabled: false, format: "DD.MM.YYYY", template: "", tag: "#Journal" },
      weekly: { format: "[no parts]", tag: "two words" },
      monthly: "broken",
    });
    expect(settings.daily).toEqual({ enabled: false, format: "DD.MM.YYYY", template: "", tag: "Journal" });
    expect(settings.weekly).toEqual({ ...NOTES_PERIODIC_DEFAULTS.weekly, tag: "" });
    expect(settings.monthly).toEqual(NOTES_PERIODIC_DEFAULTS.monthly);
    expect(settings.weekStart).toBe("locale");
    expect(normalizePeriodic({ weekStart: "sunday" }).weekStart).toBe("sunday");
    expect(normalizePeriodic({ weekStart: "friday" }).weekStart).toBe("locale");
    expect(cleanTag(" #lab/2026 ")).toBe("lab/2026");
    expect(readPeriodic("{not json")).toBe(NOTES_PERIODIC_DEFAULTS);
    expect(readPeriodic(null)).toBe(NOTES_PERIODIC_DEFAULTS);
    expect(readPeriodic(JSON.stringify({ daily: { tag: "" } })).daily.tag).toBe("");
  });
});
