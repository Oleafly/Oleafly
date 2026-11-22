// @vitest-environment jsdom

import { expect, it } from "vitest";

function loaded(module: Record<string, unknown>): boolean {
  try {
    return typeof module.latexTreeSupport === "function" && typeof module.visualMode === "function";
  } catch {
    return false;
  }
}

it("hands every lazy import a fully loaded module while the first one is still loading", async () => {
  let settled = false;
  const first = import("./index").then((module) => {
    settled = true;
    return loaded(module);
  });
  const later: Promise<boolean>[] = [];
  while (!settled) {
    later.push(import("./index").then((module) => loaded(module)));
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const results = await Promise.all([first, ...later]);
  expect(results.filter((ok) => !ok)).toEqual([]);
});
