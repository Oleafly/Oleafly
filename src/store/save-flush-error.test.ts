import { describe, expect, it } from "vitest";
import errors from "@/i18n/locales/en/errors.json" with { type: "json" };
import { SaveFlushError, codedSaveFailure, describeSaveFailure } from "./save-flush-error";

const readOnly = `@oleafly/error:${JSON.stringify({ code: "project.not_found", params: {}, detail: null })}`;

describe("save flush errors", () => {
  it("describes coded and plain failures", () => {
    expect(describeSaveFailure({ path: "a.tex", reason: readOnly })).toBe(errors.project.not_found);
    expect(describeSaveFailure({ path: "a.tex", reason: "disk full" })).toBe("disk full");
  });

  it("lists every failed file in its message", () => {
    const error = new SaveFlushError([
      { path: "a.tex", reason: "disk full" },
      { path: "b.tex", reason: readOnly },
    ]);

    expect(error.name).toBe("SaveFlushError");
    expect(error.message).toBe(`a.tex: disk full\nb.tex: ${errors.project.not_found}`);
    expect(error.failures).toHaveLength(2);
  });

  it("finds the first coded failure of a flush error only", () => {
    expect(codedSaveFailure(new Error("plain"))).toBeNull();
    expect(codedSaveFailure(new SaveFlushError([{ path: "a.tex", reason: "disk full" }]))).toBeNull();
    expect(
      codedSaveFailure(
        new SaveFlushError([
          { path: "a.tex", reason: "disk full" },
          { path: "b.tex", reason: readOnly },
        ]),
      ),
    ).toBe(readOnly);
  });
});
