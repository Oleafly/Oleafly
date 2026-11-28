import { describe, expect, it } from "vitest";
import type { CompileError } from "@/lib/tauri";
import { packageLabel, runtimeNeedFor } from "./runtime-needs";

function coded(code: string, params: Record<string, string> = {}): CompileError {
  return { kind: "error", code, params, message: code, line: null, file: null, explanation: null };
}

describe("runtimeNeedFor", () => {
  it("asks for the language when R or Python is missing", () => {
    expect(runtimeNeedFor([coded("notebook.r_missing")], true)).toEqual({ kind: "runtime", runtime: "r" });
    expect(runtimeNeedFor([coded("notebook.python_missing")], true)).toEqual({ kind: "runtime", runtime: "python" });
  });

  it("asks for the named package, and for Jupyter when Quarto can't find it", () => {
    expect(runtimeNeedFor([coded("notebook.r_package_missing", { package: "ggplot2" })], true)).toEqual({
      kind: "packages",
      runtime: "r",
      packages: ["ggplot2"],
    });
    expect(runtimeNeedFor([coded("notebook.python_module_missing", { module: "sklearn", package: "scikit-learn" })], true)).toEqual({
      kind: "packages",
      runtime: "python",
      packages: ["scikit-learn"],
    });
    expect(runtimeNeedFor([coded("notebook.jupyter_missing", { command: "python3 -m pip install jupyter" })], false)).toEqual({
      kind: "packages",
      runtime: "python",
      packages: ["jupyter"],
    });
  });

  it("offers nothing when the log did not name the package, or for other errors", () => {
    expect(runtimeNeedFor([coded("notebook.r_package_missing")], true)).toBeNull();
    expect(runtimeNeedFor([coded("tex.undefined_control_sequence"), { ...coded("x"), code: null }], true)).toBeNull();
  });

  it("takes the first error that names something to install", () => {
    expect(
      runtimeNeedFor([coded("tex.other"), coded("notebook.python_missing"), coded("notebook.r_missing")], false),
    ).toEqual({ kind: "runtime", runtime: "python" });
  });

  it("offers only knitr, rmarkdown and Jupyter while code is off", () => {
    const ggplot = coded("notebook.r_package_missing", { package: "ggplot2" });
    const knitr = coded("notebook.r_package_missing", { package: "knitr" });
    expect(runtimeNeedFor([ggplot], false)).toBeNull();
    expect(runtimeNeedFor([ggplot, knitr], false)).toEqual({ kind: "packages", runtime: "r", packages: ["knitr"] });
  });

  it("writes Jupyter with its capital and leaves package names alone", () => {
    expect(packageLabel("jupyter")).toBe("Jupyter");
    expect(packageLabel("data.table")).toBe("data.table");
  });
});
