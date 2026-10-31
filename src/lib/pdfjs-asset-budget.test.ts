import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  measurePdfjsAssets,
  PDFJS_ASSET_LIMITS,
  pdfjsAssetFailures,
  pdfjsAssetSummary,
} from "../../scripts/pdfjs-asset-budget.mjs";
import { pdfjsAssetFiles } from "../../vite.config";

const builds: string[] = [];

function builtPdfjsFolder(): string {
  const dist = mkdtempSync(path.join(tmpdir(), "oleafly-pdfjs-budget-"));
  builds.push(dist);
  for (const [fileName, source] of pdfjsAssetFiles()) {
    const target = path.join(dist, fileName);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  return path.join(dist, "pdfjs");
}

afterEach(() => {
  for (const dist of builds.splice(0)) rmSync(dist, { recursive: true, force: true });
});

describe("the pdf.js files budget", () => {
  it("has a ceiling for every folder the build ships, and today's files fit under each", async () => {
    const folders = new Set([...pdfjsAssetFiles().keys()].map((fileName) => fileName.split("/")[1]));
    expect(Object.keys(PDFJS_ASSET_LIMITS).sort()).toEqual([...folders].sort());
    const measured = await measurePdfjsAssets(builtPdfjsFolder());
    expect(pdfjsAssetFailures(measured)).toEqual([]);
    for (const [folder, bytes] of Object.entries(pdfjsAssetSummary(measured))) {
      expect(bytes, folder).toBeGreaterThan(PDFJS_ASSET_LIMITS[folder] * 0.95);
    }
  });

  it("names a folder that grew past its ceiling", async () => {
    const pdfjs = builtPdfjsFolder();
    writeFileSync(path.join(pdfjs, "cmaps", "Grown-H.bcmap"), new Uint8Array(PDFJS_ASSET_LIMITS.cmaps));
    const failures = pdfjsAssetFailures(await measurePdfjsAssets(pathToFileURL(`${pdfjs}/`)));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^pdfjs\/cmaps is \d+ bytes, over 1200000$/u);
  });

  it("fails when a folder is missing or a new one ships without a ceiling", async () => {
    const pdfjs = builtPdfjsFolder();
    rmSync(path.join(pdfjs, "iccs"), { recursive: true });
    mkdirSync(path.join(pdfjs, "sandbox"));
    writeFileSync(path.join(pdfjs, "sandbox", "quickjs-eval.wasm"), new Uint8Array(10));
    expect(pdfjsAssetFailures(await measurePdfjsAssets(pdfjs))).toEqual([
      "pdfjs/iccs is missing; pdf.js needs it",
      "pdfjs/sandbox has no size limit; add it to the budget",
    ]);
  });

  it("reports every folder as missing when the build shipped none of them", async () => {
    const measured = await measurePdfjsAssets(path.join(tmpdir(), "oleafly-no-such-build", "pdfjs"));
    expect(measured).toEqual({});
    expect(pdfjsAssetFailures(measured)).toEqual(
      Object.keys(PDFJS_ASSET_LIMITS).map((folder) => `pdfjs/${folder} is missing; pdf.js needs it`),
    );
  });
});
