// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const styles = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

function cursorRules(): string {
  const uncommented = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...uncommented.matchAll(/([^{}]+)\{\s*cursor:\s*([a-z-]+);\s*\}/g)]
    .map(([, selector, cursor]) => `${selector.trim()} { cursor: ${cursor}; }`)
    .join("\n");
}

describe("global cursors", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("keeps the pointer on enabled command items and not-allowed on disabled controls", () => {
    document.head.innerHTML = `<style>${cursorRules()}</style>`;
    document.body.innerHTML = [
      '<div cmdk-item="" data-disabled="false" aria-disabled="false" id="cmdk-on"></div>',
      '<div cmdk-item="" data-disabled="true" aria-disabled="true" id="cmdk-off"></div>',
      '<div role="menuitem" id="radix-on"></div>',
      '<div role="menuitem" data-disabled="" id="radix-off"></div>',
      '<button type="button" disabled id="button-off"></button>',
    ].join("");
    const cursor = (id: string) => getComputedStyle(document.getElementById(id) as HTMLElement).cursor;

    expect(cursor("cmdk-on")).toBe("pointer");
    expect(cursor("radix-on")).toBe("pointer");
    expect(cursor("cmdk-off")).toBe("not-allowed");
    expect(cursor("radix-off")).toBe("not-allowed");
    expect(cursor("button-off")).toBe("not-allowed");
  });
});
