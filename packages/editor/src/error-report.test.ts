import { afterEach, describe, expect, it, vi } from "vitest";
import { reportEditorError, setEditorErrorReporter } from "./error-report";

afterEach(() => {
  setEditorErrorReporter(null);
  vi.restoreAllMocks();
});

describe("reportEditorError", () => {
  it("writes to the console when no reporter is set", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new RangeError("past the end");
    reportEditorError("markdown toolbar", error);
    expect(consoleError).toHaveBeenCalledWith("markdown toolbar", error);
  });

  it("still writes to the console when the app's reporter is set, and hands the error to it", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: unknown[] = [];
    setEditorErrorReporter((scope, error) => seen.push([scope, error]));
    const error = new RangeError("past the end");
    reportEditorError("markdown toolbar", error);
    expect(seen).toEqual([["markdown toolbar", error]]);
    expect(consoleError).toHaveBeenCalledWith("markdown toolbar", error);
  });

  it("goes back to the console alone once the reporter is cleared", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: unknown[] = [];
    setEditorErrorReporter((_scope, error) => seen.push(error));
    setEditorErrorReporter(null);
    reportEditorError("markdown toolbar", "lost");
    expect(seen).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith("markdown toolbar", "lost");
  });
});
