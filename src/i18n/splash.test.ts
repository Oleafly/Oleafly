import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@oleafly/i18n-contract";

type Shell = { splash: Record<string, string> };

function shellCatalog(locale: string): Shell {
  return JSON.parse(readFileSync(new URL(`./locales/${locale}/shell.json`, import.meta.url), "utf8")) as Shell;
}

describe("boot splash narration", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const match = /var narration = (\{[\s\S]*?\});/.exec(html);
  const narration = JSON.parse(match?.[1] ?? "{}") as Record<string, { stages: string[]; starting: string }>;
  const shipped = /var shipped = (\[[^\]]*\]);/.exec(html);
  const prePaintLocales = JSON.parse(shipped?.[1] ?? "[]") as string[];

  it("lists every supported locale in the pre-paint script", () => {
    expect(prePaintLocales).toEqual([...SUPPORTED_LOCALES]);
    expect(Object.keys(narration).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it.each([...SUPPORTED_LOCALES])("matches the %s shell catalog", (locale) => {
    const { splash } = shellCatalog(locale);
    expect(narration[locale]?.stages).toEqual([
      splash.initializing,
      splash.loadingCore,
      splash.loadingHarness,
      splash.loadingParsers,
    ]);
    expect(narration[locale]?.starting).toBe(splash.starting);
  });
});
