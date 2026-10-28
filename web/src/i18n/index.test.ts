import { afterEach, describe, expect, it } from "vitest";
import de from "./de.json";
import pl from "./pl.json";
import deEditor from "@/i18n/locales/de/editor.json";
import dePreview from "@/i18n/locales/de/preview.json";
import { applyWebLocale, webI18n } from "./index";
import { editorMessage, previewMessage } from "./packages";

type Untyped = (key: string, params?: Record<string, unknown>) => string;
const t = webI18n.t as unknown as Untyped;

afterEach(async () => {
  await applyWebLocale("en");
});

describe("web i18n loading", () => {
  it("starts in English with the page language set", () => {
    expect(webI18n.language).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(t("app.signOut")).toBe("Sign out");
  });

  it("loads a locale's web strings and the editor and PDF viewer strings it reuses", async () => {
    await expect(applyWebLocale("de")).resolves.toBe("de");
    expect(webI18n.language).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    expect(document.documentElement.dir).toBe("ltr");
    expect(t("app.signOut")).toBe(de.app.signOut);
    expect(t("projects.ownedBy", { name: "Ana" })).toBe(de.projects.ownedBy.replace("{{name}}", "Ana"));
    expect(editorMessage("search.find")).toBe(deEditor.package.search.find);
    expect(previewMessage("error.invalid")).toBe(dePreview.package.error.invalid);
  });

  it("uses the locale's plural forms", async () => {
    await applyWebLocale("pl");
    expect(t("suggestions.pending", { count: 1 })).toBe(pl.suggestions.pending_one.replace("{{count}}", "1"));
    expect(t("suggestions.pending", { count: 3 })).toBe(pl.suggestions.pending_few.replace("{{count}}", "3"));
    expect(t("suggestions.pending", { count: 5 })).toBe(pl.suggestions.pending_many.replace("{{count}}", "5"));
  });

  it("goes back to English", async () => {
    await applyWebLocale("fr");
    await expect(applyWebLocale("en")).resolves.toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(t("app.signOut")).toBe("Sign out");
  });
});
