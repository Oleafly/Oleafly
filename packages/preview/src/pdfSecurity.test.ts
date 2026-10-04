import { describe, expect, it } from "vitest";
import { safePdfExternalUrl } from "./pdfSecurity";

describe("safePdfExternalUrl", () => {
  it.each([
    [" https://example.org/paper?id=1 ", "https://example.org/paper?id=1"],
    ["http://example.org", "http://example.org/"],
    ["mailto:editor@example.org", "mailto:editor@example.org"],
    ["tel:+15551234567", "tel:+15551234567"],
    ["HTTPS://Example.ORG/Path", "https://example.org/Path"],
  ])("allows %s", (input, expected) => {
    expect(safePdfExternalUrl(input)).toBe(expected);
  });

  it.each([
    ["an empty string", "   "],
    ["a control character", "https://example.org/\u0007"],
    ["an overlong URL", `https://example.org/${"a".repeat(8_200)}`],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<p>hi</p>"],
    ["a file URL", "file:///etc/passwd"],
    ["embedded credentials", "https://user:pass@example.org/"],
    ["a username alone", "http://user@example.org/"],
    ["a relative reference", "/relative/path"],
  ])("rejects %s", (_label, input) => {
    expect(safePdfExternalUrl(input)).toBeNull();
  });
});
