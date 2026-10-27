import { afterEach, describe, expect, it } from "vitest";
import { flattenCatalog, SUPPORTED_LOCALES } from "@oleafly/i18n-contract";
import { applyLocale, loadNamespace } from "@/i18n";
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { APP_ERROR_PREFIX, decodeAppError, describeError, errorText } from "./app-error";

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

  it("finds codes of a lazily loaded namespace once that namespace is loaded", async () => {
    const value = encoded({ code: "cloud.revoked", params: {}, detail: null });
    await loadNamespace("cloud");
    expect(describeError(value)).toBe("Dropbox access was revoked. Connect again.");
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

  it("turns a coded message into a sentence and leaves plain text alone", () => {
    expect(errorText(encoded({ code: "acp.start.cancelled", params: {}, detail: null }))).toBe("The start was cancelled.");
    expect(errorText("The agent disconnected.")).toBe("The agent disconnected.");
    expect(errorText("")).toBe("");
  });

  it("has every CLI agent failure in every locale, with its values filled in", async () => {
    const acpKeys = [...flattenCatalog(enErrors.acp)].filter(([key]) => !key.startsWith("program."));
    expect(acpKeys.length).toBeGreaterThan(50);
    const params = {
      version: "2", required: "20", major: "18", package: "pi-acp", found: "0.0.1", pinned: "0.0.34",
      kind: "NotFound", path: "agent-bin", output: "panic-boom", minutes: "20", provider: "DeepSeek",
      env_key: "DEEPSEEK_API_KEY", host: "registry.npmjs.org", code: "ECONNREFUSED",
    };
    const fallback = describeError(encoded({ code: "acp.nope", params: {}, detail: null }));
    for (const locale of SUPPORTED_LOCALES) {
      await applyLocale(locale);
      for (const [key, english] of acpKeys) {
        const message = describeError(encoded({ code: `acp.${key}`, params, detail: null }));
        expect(message, `${locale} ${key}`).not.toBe(fallback);
        expect(message, `${locale} ${key}`).not.toMatch(/errors:|\{\{|@oleafly/);
        for (const [name, value] of Object.entries(params)) {
          if (english.includes(`{{${name}}}`)) expect(message, `${locale} ${key}`).toContain(value);
        }
      }
    }
  });

  it("follows the active locale", async () => {
    await applyLocale("zh-Hans");
    const message = describeError(encoded({ code: "project.name_empty", params: {}, detail: null }));
    expect(message).not.toBe("");
    expect(message).not.toMatch(/errors:/);
  });
});
