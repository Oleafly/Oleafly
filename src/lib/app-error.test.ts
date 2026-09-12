import { afterEach, describe, expect, it } from "vitest";
import { applyLocale } from "@/i18n";
import { APP_ERROR_PREFIX, decodeAppError, describeError } from "./app-error";

const encoded = (payload: unknown) => `${APP_ERROR_PREFIX}${JSON.stringify(payload)}`;

describe("app errors", () => {
  afterEach(async () => {
    await applyLocale("en");
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

  it("follows the active locale", async () => {
    await applyLocale("zh-Hans");
    const message = describeError(encoded({ code: "project.name_empty", params: {}, detail: null }));
    expect(message).not.toBe("");
    expect(message).not.toMatch(/errors:/);
  });
});
