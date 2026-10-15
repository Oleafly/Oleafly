import { describe, expect, it } from "vitest";
import { looksLikeDomain, looksLikeEmailAddress, looksLikeLogin } from "./address-checks";

describe("access rule shape checks", () => {
  it.each(["cs.uni.edu", "@uni.edu", "UNI.EDU", "uni.edu.", "a-b.uni.edu", "123.example.org", "münchen.de"])(
    "takes %s as a domain",
    (value) => expect(looksLikeDomain(value)).toBe(true),
  );

  it.each(["uni", "https://uni.edu", "uni_lab.edu", "-uni.edu", "uni-.edu", "uni..edu", "uni.edu/path", "", "@"])(
    "refuses %s as a domain",
    (value) => expect(looksLikeDomain(value)).toBe(false),
  );

  it("checks a long run of dots in linear time", () => {
    const started = performance.now();
    expect(looksLikeDomain(`uni.edu${".".repeat(200_000)}`)).toBe(true);
    expect(looksLikeDomain(`uni${".".repeat(200_000)}edu`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it.each(["ada@uni.edu", " ada@cs.uni.edu ", "first.last+tag@uni.edu"])("takes %s as an email address", (value) =>
    expect(looksLikeEmailAddress(value)).toBe(true),
  );

  it.each(["ada@uni", "@uni.edu", "ada lovelace@uni.edu", "a@b@uni.edu", "ada", "ada@https://uni.edu"])(
    "refuses %s as an email address",
    (value) => expect(looksLikeEmailAddress(value)).toBe(false),
  );

  it("takes a sign-in name with or without its @, and refuses spaces, nothing and very long names", () => {
    expect(looksLikeLogin("octocat")).toBe(true);
    expect(looksLikeLogin("@octocat")).toBe(true);
    expect(looksLikeLogin("ada lovelace")).toBe(false);
    expect(looksLikeLogin("@")).toBe(false);
    expect(looksLikeLogin("x".repeat(101))).toBe(false);
  });
});
