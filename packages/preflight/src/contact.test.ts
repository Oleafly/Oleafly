import { describe, expect, it } from "vitest";
import { containsContactToken, extractPhoneNumber } from "./contact";
import { simulateAtsParse } from "./ats-parse";

describe("phone extraction", () => {
  it.each([
    ["US hyphenated", "555-123-4567", "555-123-4567"],
    ["US parenthesized", "(415) 555-2671", "(415) 555-2671"],
    ["US dotted", "415.555.2671", "415.555.2671"],
    ["international UK", "+44 20 7946 0958", "+44 20 7946 0958"],
    ["international India", "+91 98765 43210", "+91 98765 43210"],
    ["international Germany", "+49 30 12345678", "+49 30 12345678"],
    ["international France", "+33 1 42 68 53 00", "+33 1 42 68 53 00"],
    ["contiguous E.164", "+14155552671", "+14155552671"],
    ["tel URI", "tel:+1 (415) 555-2671", "+1 (415) 555-2671"],
  ])("accepts a real %s number", (_label, input, expected) => {
    expect(extractPhoneNumber(input)).toBe(expected);
  });

  it.each([
    "2020-2024",
    "2016 – 2020",
    "2024.07.25",
    "07/25/2024",
    "GPA 3.8/4.0",
    "SSN 123-45-6789",
    "Version 2024-2025",
  ])("rejects non-phone numeric content: %s", (input) => {
    expect(extractPhoneNumber(input)).toBeNull();
  });

  it("does not let a date range satisfy the ATS phone field", () => {
    const parse = simulateAtsParse(
      ["Jane Doe", "jane@example.com", "Experience", "Engineer, 2020-2024"].join(
        "\n",
      ),
    );
    expect(parse.isResume).toBe(true);
    expect(parse.phone).toBeNull();
  });

  it("does not treat an invalid tel date range as a contact token", () => {
    expect(containsContactToken("\\faPhone \\href{tel:2020-2024}")).toBe(false);
    expect(containsContactToken("\\faPhone \\href{tel:+33 1 42 68 53 00}")).toBe(
      true,
    );
  });
});
