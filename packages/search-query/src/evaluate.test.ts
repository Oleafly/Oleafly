import { describe, expect, it } from "vitest";
import { compile } from "./evaluate";
import { context, ids, query, schema } from "./testing";

describe("runQuery", () => {
  it("returns everything in the default order for an empty query", () => {
    expect(ids("")).toBe("adbc");
    expect(compile(query(""), schema, context).filtered).toBe(false);
  });

  it("matches free text across scopes, ignoring case and accents", () => {
    expect(ids("draft")).toBe("a");
    expect(ids("RESUME")).toBe("d");
    expect(ids('"lab notes"')).toBe("b");
    expect(ids("notes lab")).toBe("b");
    expect(ids("c")).toBe("c");
  });

  it("limits free text with in:", () => {
    expect(ids("120 pages")).toBe("a");
    expect(ids("120 in:title")).toBe("");
    expect(query("x in:pages").diagnostics.map((issue) => issue.code)).toEqual(["invalid-value"]);
    expect(ids("c in:id")).toBe("c");
    expect(ids("c in:title")).toBe("c");
    expect(ids("b in:id,title")).toBe("b");
  });

  it("filters by enum values and their aliases", () => {
    expect(ids("engine:typst")).toBe("dc");
    expect(ids("engine:LaTeX")).toBe("a");
    expect(ids("engine:typst,md")).toBe("dbc");
  });

  it("treats repeated qualifiers as AND", () => {
    expect(ids("engine:typst engine:markdown")).toBe("");
    expect(ids("tag:draft tag:phd")).toBe("a");
  });

  it("excludes with a dash or NOT", () => {
    expect(ids("-engine:typst")).toBe("ab");
    expect(ids("NOT engine:typst")).toBe("ab");
    expect(ids("-draft")).toBe("dbc");
    expect(ids("-engine:typst,markdown")).toBe("a");
  });

  it("combines with AND, OR and groups", () => {
    expect(ids("engine:typst OR is:starred")).toBe("adc");
    expect(ids("engine:typst AND is:starred")).toBe("d");
    expect(ids("(engine:typst OR engine:markdown) has:preview")).toBe("c");
    expect(ids("is:starred engine:typst OR engine:markdown")).toBe("db");
    expect(ids("-(engine:typst OR engine:markdown)")).toBe("a");
  });

  it("supports is:, has: and no: flags", () => {
    expect(ids("is:favorite")).toBe("ad");
    expect(ids("has:pdf")).toBe("ac");
    expect(ids("no:preview")).toBe("db");
    expect(ids("no:tags")).toBe("d");
  });

  it("compares numbers and dates", () => {
    expect(ids("pages:>3")).toBe("ab");
    expect(ids("pages:1..2")).toBe("dc");
    expect(ids("created:>=@today-7d")).toBe("a");
    expect(ids("created:<@today-30d")).toBe("bc");
    expect(ids("created:>=@today-30d,<@today-365d")).toBe("adc");
  });

  it("searches an unknown qualifier as plain text, like GitHub", () => {
    expect(ids("colour:red")).toBe("");
    expect(ids("-colour:red")).toBe("adbc");
    expect(query("colour:red").diagnostics.map((issue) => issue.code)).toEqual(["unknown-qualifier"]);
  });

  it("sorts with sort:, defaulting to descending", () => {
    expect(ids("sort:created-asc")).toBe("cbda");
    expect(ids("sort:name-asc")).toBe("cbda");
    expect(ids("sort:title")).toBe("adbc");
    expect(ids("sort:title-desc")).toBe("adbc");
    expect(ids("sort:created-asc sort:created-desc")).toBe("adbc");
    expect(ids("is:starred OR engine:markdown sort:created-asc")).toBe("bda");
    expect(query("-sort:title").diagnostics.map((issue) => issue.code)).toEqual(["sort-negated"]);
    expect(ids("-sort:title")).toBe("adbc");
  });

  it("ignores invalid terms instead of hiding everything", () => {
    expect(ids("engine:banana")).toBe("adbc");
    expect(ids("-engine:banana")).toBe("adbc");
    expect(ids("engine:")).toBe("adbc");
    expect(ids("created:soon")).toBe("adbc");
    expect(ids("is:starred OR engine:banana")).toBe("ad");
    expect(ids("engine:typst,banana")).toBe("dc");
    expect(ids("created:soon,>=@today-7d")).toBe("a");
  });
});
