import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en/core.json" with { type: "json" };
import type { CompileError } from "@/lib/tauri";
import { explainTypstPackageErrors } from "./typst-package-errors";

const text = en.compile.typstPackage;

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function error(message: string, explanation: string | null = null): CompileError {
  return { line: 1, file: "main.typ", message, kind: "error", explanation };
}

const DOWNLOAD =
  "failed to download package (https://packages.typst.org/preview/cetz-0.4.2.tar.gz: Connection Failed: Connect error: Connection refused (os error 61))";

describe("explainTypstPackageErrors", () => {
  it("names the package Typst could not download", () => {
    const [explained] = explainTypstPackageErrors([error(DOWNLOAD)], false);
    expect(explained.explanation).toBe(fill(text.downloadFailed, { spec: "@preview/cetz:0.4.2" }));
    expect(explained.message).toBe(DOWNLOAD);
  });

  it("says the package is not cached yet when offline", () => {
    const [named, unnamed] = explainTypstPackageErrors(
      [error(DOWNLOAD), error("failed to download package (Network Error: timed out)")],
      true,
    );
    expect(named.explanation).toBe(fill(text.offlineNotCached, { spec: "@preview/cetz:0.4.2" }));
    expect(unnamed.explanation).toBe(text.offlineNotCachedUnnamed);
    const [online] = explainTypstPackageErrors(
      [error("failed to download package (Network Error: timed out)")],
      false,
    );
    expect(online.explanation).toBe(text.downloadFailedUnnamed);
  });

  it("explains unknown packages, local packages and missing versions", () => {
    const [preview, local, version, oldVersion] = explainTypstPackageErrors(
      [
        error("package not found (searched for @preview/zz-nothing:0.1.0)"),
        error("package not found (searched for @local/mine:0.2.0)"),
        error("package found, but version 99.0.0 does not exist (latest is 0.5.2)"),
        error("package found, but version 2.0.0 does not exist"),
      ],
      false,
    );
    expect(preview.explanation).toBe(fill(text.notFound, { spec: "@preview/zz-nothing:0.1.0" }));
    expect(local.explanation).toBe(fill(text.localNotFound, { spec: "@local/mine:0.2.0" }));
    expect(version.explanation).toBe(fill(text.versionMissing, { version: "99.0.0", latest: "0.5.2" }));
    expect(oldVersion.explanation).toBe(fill(text.versionMissingNoLatest, { version: "2.0.0" }));
  });

  it("leaves other errors and existing explanations alone", () => {
    const untouched = [
      error("unknown variable: foo"),
      error(DOWNLOAD, "Already explained."),
    ];
    expect(explainTypstPackageErrors(untouched, false)).toEqual(untouched);
  });
});
