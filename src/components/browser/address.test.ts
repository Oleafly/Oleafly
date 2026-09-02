import { describe, expect, it } from "vitest";
import { displayHost, FALLBACK_SEARCH_URL, resolveAddressInput, tabText } from "./address";

const GOOGLE = "https://www.google.com/search?q=";

describe("resolveAddressInput", () => {
  it("returns null for empty input", () => {
    expect(resolveAddressInput("")).toBeNull();
    expect(resolveAddressInput("   ")).toBeNull();
  });

  it("keeps http and https URLs as they are", () => {
    expect(resolveAddressInput("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
    expect(resolveAddressInput("  http://example.org  ")).toBe("http://example.org/");
  });

  it("adds https to a bare domain, an IP, localhost, and host:port", () => {
    expect(resolveAddressInput("example.com")).toBe("https://example.com/");
    expect(resolveAddressInput("docs.example.co.uk/path?x=1")).toBe(
      "https://docs.example.co.uk/path?x=1",
    );
    expect(resolveAddressInput("127.0.0.1:8080/x")).toBe("https://127.0.0.1:8080/x");
    expect(resolveAddressInput("localhost")).toBe("https://localhost/");
    expect(resolveAddressInput("localhost:1420")).toBe("https://localhost:1420/");
  });

  it("turns plain text into a search on the given engine", () => {
    expect(resolveAddressInput("latex tables", GOOGLE)).toBe(`${GOOGLE}latex%20tables`);
    expect(resolveAddressInput("hello", GOOGLE)).toBe(`${GOOGLE}hello`);
  });

  it("falls back to DuckDuckGo when no engine is given", () => {
    expect(resolveAddressInput("quantum error correction")).toBe(
      `${FALLBACK_SEARCH_URL}quantum%20error%20correction`,
    );
  });

  it("never returns a non-web scheme", () => {
    for (const input of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<b>x</b>",
      "tauri://localhost",
      "mailto:someone@example.com",
    ]) {
      const resolved = resolveAddressInput(input, GOOGLE);
      expect(resolved).toBe(`${GOOGLE}${encodeURIComponent(input)}`);
    }
  });

  it("treats text with spaces as a search even if it looks like a domain", () => {
    expect(resolveAddressInput("example.com is down", GOOGLE)).toBe(
      `${GOOGLE}example.com%20is%20down`,
    );
  });
});

describe("displayHost and tabText", () => {
  it("strips www and falls back gracefully", () => {
    expect(displayHost("https://www.example.com/x")).toBe("example.com");
    expect(displayHost("https://sub.example.com")).toBe("sub.example.com");
    expect(displayHost("not a url")).toBe("");
  });

  it("prefers the title, then the host, then a placeholder", () => {
    expect(tabText({ url: "https://www.example.com", title: "Example" })).toBe("Example");
    expect(tabText({ url: "https://www.example.com", title: "  " })).toBe("example.com");
    expect(tabText({ url: "", title: "" })).toBe("New tab");
  });
});
