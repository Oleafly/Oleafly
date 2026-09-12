import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import enShell from "./locales/en/shell.json" with { type: "json" };
import zhHansShell from "./locales/zh-Hans/shell.json" with { type: "json" };

describe("boot splash narration", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const match = /var narration = (\{[\s\S]*?\});/.exec(html);
  const narration = JSON.parse(match?.[1] ?? "{}") as Record<string, { stages: string[]; starting: string }>;

  it.each([
    ["en", enShell],
    ["zh-Hans", zhHansShell],
  ])("matches the %s shell catalog", (locale, shell) => {
    expect(narration[locale]?.stages).toEqual([
      shell.splash.initializing,
      shell.splash.loadingCore,
      shell.splash.loadingHarness,
      shell.splash.loadingParsers,
    ]);
    expect(narration[locale]?.starting).toBe(shell.splash.starting);
  });
});
