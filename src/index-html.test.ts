// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

function elementsAfterRoot(source: string): Element[] {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const root = parsed.getElementById("root");
  const after: Element[] = [];
  for (let node = root?.nextElementSibling ?? null; node; node = node.nextElementSibling) {
    after.push(node);
  }
  return after;
}

describe("index.html body", () => {
  it("keeps a non-script element after the app root, so overlays appended to body never make the root the last child", () => {
    const after = elementsAfterRoot(html).filter((element) => element.tagName !== "SCRIPT");
    expect(after.length).toBeGreaterThan(0);
    expect(after[0]?.hasAttribute("hidden")).toBe(true);
  });

  it("still has a non-script element after the root once the build moves the entry script into head", () => {
    const built = html.replace(/<script type="module"[^>]*><\/script>/, "");
    expect(elementsAfterRoot(built).some((element) => element.tagName !== "SCRIPT")).toBe(true);
  });
});
