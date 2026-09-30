import { afterEach, describe, expect, it } from "vitest";
import { applyLocale } from "@/i18n";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { APP_ERROR_PREFIX, decodeAppError, describeError } from "./app-error";

const encoded = (payload: unknown) => `${APP_ERROR_PREFIX}${JSON.stringify(payload)}`;

describe("app errors", () => {
  afterEach(async () => {
    resetDisplayHomes();
    await applyLocale("en");
  });

  it("shows home paths in error text as ~", () => {
    setDisplayHomes(["/Users/ada"]);
    expect(
      describeError(new Error('failed to create projects root "/Users/ada/.oleafly/projects": denied')),
    ).toBe('failed to create projects root "~/.oleafly/projects": denied');
    const value = encoded({ code: "compile.failed", params: {}, detail: "cannot read /Users/ada/a.tex" });
    expect(describeError(value)).toContain("(cannot read ~/a.tex)");
  });

  it("decodes the envelope and localizes known codes", () => {
    const error = decodeAppError(encoded({ code: "project.name_empty", params: {}, detail: null }));
    expect(error?.code).toBe("project.name_empty");
    expect(describeError(error)).toBe("Project name cannot be empty.");
  });

  it("interpolates params", () => {
    const value = encoded({ code: "project.name_conflict", params: { name: "Thesis" }, detail: null });
    expect(describeError(value)).toBe("A project named Thesis already exists.");
  });

  it("keeps detail verbatim under a localized heading for unknown codes", () => {
    const value = encoded({ code: "compile.failed", params: {}, detail: "! Undefined control sequence." });
    expect(describeError(value)).toBe(
      "Something went wrong. See the app log for details. (! Undefined control sequence.)",
    );
  });

  it("passes plain errors through", () => {
    expect(describeError(new Error("disk full"))).toBe("disk full");
    expect(describeError("plain")).toBe("plain");
    expect(describeError(undefined)).toBe("Something went wrong. See the app log for details.");
    expect(decodeAppError(`${APP_ERROR_PREFIX}not json`)).toBeNull();
  });

  it("names the capability a restricted folder is missing, in every locale", async () => {
    const codes = [
      "trust.git",
      "trust.repository",
      "trust.terminal",
      "trust.agents",
      "trust.mcp",
      "trust.research_tasks",
      "trust.run_command",
      "trust.full_access",
      "trust.system_tex",
      "trust.shell_escape",
      "trust.broad_folder",
      "trust.declined",
      "trust.unavailable",
    ];
    const fallback = describeError(encoded({ code: "trust.nope", params: {}, detail: null }));
    for (const locale of ["en", "zh-Hans", "de", "ja"] as const) {
      await applyLocale(locale);
      for (const code of codes) {
        const message = describeError(encoded({ code, params: { name: "thesis" }, detail: null }));
        expect(message, `${locale} ${code}`).not.toBe(fallback);
        expect(message, `${locale} ${code}`).not.toMatch(/errors:|\{\{/);
      }
    }
    await applyLocale("en");
    expect(
      describeError(encoded({ code: "trust.repository", params: { name: "papers" }, detail: null })),
    ).toBe("Trust the papers repository to use Source Control here.");
  });

  it("names the file a read-only opened folder refused, without OS text", async () => {
    const value = encoded({
      code: "project.folder_read_only",
      params: { name: "figures/plot.png" },
      detail: null,
    });
    expect(describeError(value)).toBe(
      "Oleafly can't make this change because figures/plot.png or its folder is read-only. Copy the folder you opened into your library and edit it there.",
    );
    await applyLocale("de");
    expect(describeError(value)).toBe(
      "Oleafly kann diese Änderung nicht vornehmen, weil figures/plot.png oder der übergeordnete Ordner schreibgeschützt ist. Kopieren Sie den geöffneten Ordner in die Bibliothek und bearbeiten Sie ihn dort.",
    );
    await applyLocale("ja");
    const japanese = describeError(value);
    expect(japanese).toContain("figures/plot.png");
    expect(japanese).not.toMatch(/errors:|\{\{|os error/);
  });

  it("follows the active locale", async () => {
    await applyLocale("zh-Hans");
    const message = describeError(encoded({ code: "project.name_empty", params: {}, detail: null }));
    expect(message).not.toBe("");
    expect(message).not.toMatch(/errors:/);
  });
});
