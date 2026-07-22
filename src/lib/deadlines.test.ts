import { describe, expect, it } from "vitest";
import {
  countdown,
  deadlineInstant,
  filterVenues,
  nextDeadline,
  sortByNextDeadline,
  sortVenues,
  urgency,
  type Venue,
} from "./deadlines";

const venue = (over: Partial<Venue>): Venue => ({
  id: "v",
  title: "VENUE 2026",
  full_name: "The Venue Conference",
  sub: "AI",
  rank: "A",
  link: "https://v",
  timezone: "UTC-12",
  deadlines: [{ kind: "paper", at: "2026-08-15 23:59:59" }],
  conf_date: "Dec 2026",
  place: "Earth",
  ...over,
});

describe("deadlineInstant", () => {
  it("AoE equals UTC-12", () => {
    const aoe = deadlineInstant("2026-08-15 23:59:59", "AoE");
    const utcMinus12 = deadlineInstant("2026-08-15 23:59:59", "UTC-12");
    expect(aoe.getTime()).toBe(utcMinus12.getTime());
    expect(aoe.toISOString()).toBe("2026-08-16T11:59:59.000Z");
  });

  it("parses positive offsets", () => {
    const d = deadlineInstant("2026-01-01 08:00:00", "UTC+8");
    expect(d.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns NaN date for garbage", () => {
    expect(Number.isNaN(deadlineInstant("TBD", "UTC").getTime())).toBe(true);
  });

  it("understands named US zones from official calls", () => {
    expect(deadlineInstant("2026-11-14 23:59:59", "PST").toISOString()).toBe(
      "2026-11-15T07:59:59.000Z",
    );
    expect(deadlineInstant("2026-05-05 17:00:00", "US Eastern").toISOString()).toBe(
      "2026-05-05T22:00:00.000Z",
    );
  });
});

describe("sortVenues and urgency", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  const a = { id: "a", title: "ZULU 2026", sub: "SE" } as Venue;
  const b = { id: "b", title: "ALPHA 2026", sub: "AI" } as Venue;

  it("sorts by name and by field", () => {
    expect(sortVenues([a, b], "name", now).map((v) => v.id)).toEqual(["b", "a"]);
    expect(sortVenues([a, b], "field", now).map((v) => v.id)).toEqual(["b", "a"]);
  });

  it("buckets urgency by days remaining", () => {
    expect(urgency(new Date("2026-07-02T00:00:00Z"), now)).toBe("critical");
    expect(urgency(new Date("2026-07-10T00:00:00Z"), now)).toBe("soon");
    expect(urgency(new Date("2026-09-01T00:00:00Z"), now)).toBe("comfortable");
  });
});

describe("countdown", () => {
  it("computes exact parts", () => {
    const target = new Date("2026-01-03T04:05:06Z");
    const now = new Date("2026-01-01T00:00:00Z");
    expect(countdown(target, now)).toEqual({ days: 2, hours: 4, minutes: 5, seconds: 6 });
  });

  it("null when passed", () => {
    expect(countdown(new Date(0), new Date(1000))).toBeNull();
  });
});

describe("filter and sort", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  const soon = venue({ id: "soon", title: "SOON 2026" });
  const later = venue({
    id: "later",
    title: "LATER 2026",
    deadlines: [{ kind: "paper", at: "2026-12-01 23:59:59" }],
  });
  const passed = venue({
    id: "old",
    title: "OLD 2026",
    sub: "SE",
    deadlines: [{ kind: "paper", at: "2026-01-01 00:00:00" }],
  });

  it("excludes passed unless requested", () => {
    expect(filterVenues([soon, passed], { now }).map((v) => v.id)).toEqual(["soon"]);
    expect(filterVenues([soon, passed], { now, showPassed: true })).toHaveLength(2);
  });

  it("filters by sub and query on title or full name", () => {
    expect(filterVenues([soon, passed], { now, sub: "SE", showPassed: true })).toHaveLength(1);
    expect(
      filterVenues([soon], { now, query: "the venue conference" }).map((v) => v.id),
    ).toEqual(["soon"]);
    expect(filterVenues([soon], { now, query: "zebra" })).toHaveLength(0);
  });

  it("sorts soonest-first with passed venues last", () => {
    const sorted = sortByNextDeadline([passed, later, soon], now);
    expect(sorted.map((v) => v.id)).toEqual(["soon", "later", "old"]);
  });

  it("nextDeadline picks the earliest upcoming entry", () => {
    const v = venue({
      deadlines: [
        { kind: "paper", at: "2026-08-15 23:59:59" },
        { kind: "abstract", at: "2026-08-08 23:59:59" },
      ],
    });
    expect(nextDeadline(v, now)?.kind).toBe("abstract");
  });
});
