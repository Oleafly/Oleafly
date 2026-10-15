import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { flattenCatalog, SUPPORTED_LOCALES } from "@oleafly/i18n-contract";

const LOCALES = fileURLToPath(new URL("./locales/", import.meta.url));
const SHELL_KEYS = [
  "settings.experimentation.liveCollaboration.description",
  "settings.experimentation.liveCollaboration.label",
  "settings.nav.collaboration",
  "settings.search.keywords.collaboration",
];

function catalog(locale: string, namespace: string): Map<string, string> {
  return flattenCatalog(JSON.parse(readFileSync(`${LOCALES}${locale}/${namespace}.json`, "utf8")));
}

const english = [...catalog("en", "collab").keys()];
const others = SUPPORTED_LOCALES.filter((locale) => locale !== "en");

describe("collaboration translations", () => {
  it.each(others)("%s has every collaboration key in the English order", (locale) => {
    expect([...catalog(locale, "collab").keys()]).toEqual(english);
  });

  it.each(others)("%s names the people list and server settings the same in Settings and the console", (locale) => {
    const keys = catalog(locale, "collab");
    expect(keys.get("admin.tabs.members")).toBe(keys.get("console.sections.people"));
    expect(keys.get("admin.tabs.settings")).toBe(keys.get("console.sections.settings"));
    expect(keys.get("activity.suspended")).toBe(keys.get("section.server.suspendedHint"));
  });

  it.each(others)("%s has the four new shell keys", (locale) => {
    const shell = catalog(locale, "shell");
    for (const key of SHELL_KEYS) expect(shell.get(key), key).toBeTruthy();
  });
});
