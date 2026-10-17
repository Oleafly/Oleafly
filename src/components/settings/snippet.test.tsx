// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { highlightSnippet, type SnippetLang } from "./snippet";

function tokens(source: string, lang: SnippetLang): [string, string][] {
  const { container } = render(<code>{highlightSnippet(source, lang)}</code>);
  return [...container.querySelectorAll("code > span")].map((span) => [span.className, span.textContent ?? ""]);
}

function kinds(source: string, lang: SnippetLang): string {
  return tokens(source, lang)
    .map(([className, text]) => {
      if (className.includes("sky")) return `key(${text})`;
      if (className.includes("emerald")) return `string(${text})`;
      if (className.includes("amber")) return `number(${text})`;
      if (className.includes("violet")) return `literal(${text})`;
      if (className.includes("muted")) return `mark(${text})`;
      return text.trim() ? `plain(${text})` : "_";
    })
    .join(" ");
}

describe("snippet highlighting", () => {
  it("colors JSON keys, strings, numbers and literals and keeps every character", () => {
    const source = '{\n  "name": "a \\"quoted\\" value",\n  "port": -12.5,\n  "on" : true,\n  "list": [null, oops]\n}';
    expect(kinds(source, "json")).toBe(
      [
        "mark({) _ key(\"name\") mark(:) _ string(\"a \\\"quoted\\\" value\") mark(,) _",
        "key(\"port\") mark(:) _ number(-12.5) mark(,) _",
        "key(\"on\") mark( :) _ literal(true) mark(,) _",
        "key(\"list\") mark(:) _ mark([) literal(null) mark(,) _ plain(oops) mark(]) _ mark(})",
      ].join(" "),
    );
    expect(tokens(source, "json").map(([, text]) => text).join("")).toBe(source);
  });

  it("ends an unterminated JSON string at the end of the text", () => {
    expect(kinds('"open', "json")).toBe('string("open)');
  });

  it("colors TOML tables, keys and strings and keeps every character", () => {
    const source = '[mcp_servers.oleafly]\ncommand = "npx"\nargs = ["-y", "mcp-remote"]\nenabled=true\n[ bare';
    expect(kinds(source, "toml")).toBe(
      [
        "key([mcp_servers.oleafly]) _ key(command) mark( = ) string(\"npx\") _",
        "key(args) mark( = ) key([\"-y\", \"mcp-remote\"]) _",
        "key(enabled) mark(=) plain(true) _ plain([) _ plain(bare)",
      ].join(" "),
    );
    expect(tokens(source, "toml").map(([, text]) => text).join("")).toBe(source);
  });
});
