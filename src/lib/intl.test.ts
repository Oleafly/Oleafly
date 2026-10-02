import { afterEach, describe, expect, it } from "vitest";
import { applyLocale } from "@/i18n";
import {
  formatCompactNumber,
  formatDate,
  formatList,
  formatNameList,
  formatNumber,
  formatRelativeTime,
  formatRelativeTimeFrom,
  relativeTimeSpan,
} from "./intl";

const NOW = Date.UTC(2026, 9, 2, 12);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JUST_NOW = "just now";

describe("intl helpers", () => {
  afterEach(async () => {
    await applyLocale("en");
  });

  it("formats with the active locale", async () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatCompactNumber(1500)).toBe("1.5K");
    expect(formatList(["a", "b", "c"])).toBe("a, b, and c");
    expect(formatRelativeTime(-3, "day")).toBe("3 days ago");
    await applyLocale("zh-Hans");
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatList(["甲", "乙"])).toBe("甲和乙");
    expect(formatRelativeTime(-3, "day")).toBe("3天前");
  });

  it("shortens a long list of names and leaves the rest to the caller", () => {
    const more = (shown: string, rest: number) => `${shown} +${rest}`;
    expect(formatNameList(["a", "b"], more)).toBe("a and b");
    expect(formatNameList(["a", "b", "c", "d"], more, 3)).toBe("a, b, c +1");
    expect(formatNameList(["a", "b", "c"], more, 3)).toBe("a, b, and c");
  });
});

describe("relativeTimeSpan", () => {
  it("counts whole elapsed units, so a unit never reaches the next one", () => {
    expect(relativeTimeSpan(NOW - 90_000, NOW)).toEqual({ unit: "minute", value: 1 });
    expect(relativeTimeSpan(NOW - (59 * MINUTE + 59_000), NOW)).toEqual({ unit: "minute", value: 59 });
    expect(relativeTimeSpan(NOW - (23 * HOUR + 59 * MINUTE), NOW)).toEqual({ unit: "hour", value: 23 });
    expect(relativeTimeSpan(NOW - 13 * DAY, NOW)).toEqual({ unit: "week", value: 1 });
    expect(relativeTimeSpan(NOW - 40 * DAY, NOW)).toEqual({ unit: "month", value: 1 });
    expect(relativeTimeSpan(NOW - 400 * DAY, NOW)).toEqual({ unit: "year", value: 1 });
  });

  it("stops at the largest unit the caller allows", () => {
    expect(relativeTimeSpan(NOW - 40 * DAY, NOW, "day")).toEqual({ unit: "day", value: 40 });
    expect(relativeTimeSpan(NOW - 3 * DAY, NOW, "hour")).toEqual({ unit: "hour", value: 72 });
  });

  it("has no span under a minute, in the future or for an unknown time", () => {
    expect(relativeTimeSpan(NOW - 59_999, NOW)).toBeNull();
    expect(relativeTimeSpan(NOW + 5 * MINUTE, NOW)).toBeNull();
    expect(relativeTimeSpan(Number.NaN, NOW)).toBeNull();
  });
});

describe("formatRelativeTimeFrom", () => {
  afterEach(async () => {
    await applyLocale("en");
  });

  it("formats the span in the active locale", async () => {
    expect(formatRelativeTimeFrom(NOW - 5 * MINUTE, NOW)).toBe("5 minutes ago");
    expect(formatRelativeTimeFrom(NOW - 36 * HOUR, NOW)).toBe("yesterday");
    expect(formatRelativeTimeFrom(NOW - 10 * DAY, NOW)).toBe("last week");
    await applyLocale("zh-Hans");
    expect(formatRelativeTimeFrom(NOW - 3 * DAY, NOW)).toBe("3天前");
  });

  it("uses the caller's label under a minute, or the locale's word for now", () => {
    expect(formatRelativeTimeFrom(NOW - 30_000, NOW)).toBe("now");
    expect(formatRelativeTimeFrom(NOW - 30_000, NOW, { justNow: JUST_NOW })).toBe(JUST_NOW);
  });

  it("hands the span to the caller's own wording", () => {
    const format = ({ unit, value }: { unit: string; value: number }) => `${value} ${unit}`;
    expect(formatRelativeTimeFrom(NOW - 3 * HOUR, NOW, { format })).toBe("3 hour");
    expect(formatRelativeTimeFrom(NOW - 30 * DAY, NOW, { format, largestUnit: "day" })).toBe("30 day");
  });

  it("shows the date once the time is older than the cutoff", () => {
    const old = NOW - 7 * DAY;
    expect(formatRelativeTimeFrom(old, NOW, { dateAfterDays: 7 })).toBe(formatDate(old, { dateStyle: "short" }));
    expect(formatRelativeTimeFrom(old + 1, NOW, { dateAfterDays: 7 })).toBe("6 days ago");
  });
});
