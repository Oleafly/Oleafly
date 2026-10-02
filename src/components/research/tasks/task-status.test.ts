import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { relativeTime } from "./task-status";

const relative = enResearchTools.tasks.relative;
const NOW = Date.UTC(2026, 9, 2, 12);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("relativeTime", () => {
  it("says just now under a minute and for a time in the future", () => {
    expect(relativeTime(NOW)).toBe(relative.justNow);
    expect(relativeTime(NOW - 30_000)).toBe(relative.justNow);
    expect(relativeTime(NOW + 5 * MINUTE)).toBe(relative.justNow);
  });

  it("counts minutes, then hours, then days", () => {
    expect(relativeTime(NOW - 5 * MINUTE)).toBe(relative.minutes.replace("{{minutes}}", "5"));
    expect(relativeTime(NOW - 3 * HOUR)).toBe(relative.hours.replace("{{hours}}", "3"));
    expect(relativeTime(NOW - 2 * DAY)).toBe(relative.days.replace("{{days}}", "2"));
    expect(relativeTime(NOW - 40 * DAY)).toBe(relative.days.replace("{{days}}", "40"));
  });

  it("counts whole units elapsed instead of rounding up", () => {
    expect(relativeTime(NOW - 90_000)).toBe(relative.minutes.replace("{{minutes}}", "1"));
    expect(relativeTime(NOW - (59 * MINUTE + 59_000))).toBe(relative.minutes.replace("{{minutes}}", "59"));
    expect(relativeTime(NOW - 36 * HOUR)).toBe(relative.days.replace("{{days}}", "1"));
  });
});
