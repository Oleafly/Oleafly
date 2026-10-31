import { afterEach, describe, expect, it } from "vitest";
import { forgetUnsent, MAX_UNSENT_AGE_MS, MAX_UNSENT_CHARS, readUnsent, writeUnsent } from "./unsent";

const typing = (base: string, at = Date.now()) => ({ base, inflight: null, rest: [base.length, "!"], at });

afterEach(() => sessionStorage.clear());

describe("unsent typing in this tab", () => {
  it("keeps typing per project and file, and forgets a file once it is cleared", () => {
    writeUnsent("p1", "f1", typing("abc"));
    writeUnsent("p1", "f2", typing("xyz"));
    writeUnsent("p2", "f1", typing("other"));
    expect(Object.keys(readUnsent("p1"))).toEqual(["f1", "f2"]);
    writeUnsent("p1", "f1", null);
    expect(Object.keys(readUnsent("p1"))).toEqual(["f2"]);
    forgetUnsent("p1");
    expect(readUnsent("p1")).toEqual({});
    expect(Object.keys(readUnsent("p2"))).toEqual(["f1"]);
  });

  it("drops typing too large or too old to keep, and anything it can't read", () => {
    writeUnsent("p1", "big", typing("x".repeat(MAX_UNSENT_CHARS)));
    expect(readUnsent("p1")).toEqual({});
    writeUnsent("p1", "old", typing("abc", 1));
    expect(readUnsent("p1", 2 + MAX_UNSENT_AGE_MS)).toEqual({});
    sessionStorage.setItem("oleafly.web.unsent.v1.p3", "{not json");
    expect(readUnsent("p3")).toEqual({});
    sessionStorage.setItem("oleafly.web.unsent.v1.p3", JSON.stringify({ f1: { base: 1 } }));
    expect(readUnsent("p3")).toEqual({});
  });
});
