import { describe, expect, it } from "vitest";
import catalog from "./tagging-status.json";
import {
  TAGGING_STATUS_RETRIEVED,
  TAGGING_STATUS_SOURCE,
  classTaggingStatus,
  documentClassOf,
  loadedPackagesOf,
  packageTaggingStatus,
  packageTaggingVerdict,
  taggingGate,
} from "./tagging-status";
import {
  buildCatalog,
  parseTaggingStatusYaml,
  validateCatalog,
  validateEntries,
} from "../../../scripts/update-tagging-status.mjs";

describe("vendored tagging-status catalog", () => {
  it("records where the data came from and when", () => {
    expect(TAGGING_STATUS_SOURCE).toBe(
      "https://github.com/latex3/tagging-project/blob/main/_data/tagging-status.yml",
    );
    expect(TAGGING_STATUS_RETRIEVED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(catalog.license).toContain("LPPL");
  });

  it("carries every document class the upstream file knows about", () => {
    expect(catalog.classes.length).toBeGreaterThan(50);
    const names = catalog.classes.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the packages upstream calls compatible instead of inferring them", () => {
    expect(catalog.packages.compatible.length).toBeGreaterThan(700);
    expect(catalog.packages.compatible).toContain("booktabs");
    expect(catalog.packages.compatible).toContain("graphicx");
  });

  it("matches the upstream verdicts for the classes people actually use", () => {
    expect(classTaggingStatus("article").status).toBe("compatible");
    expect(classTaggingStatus("report").status).toBe("compatible");
    expect(classTaggingStatus("ltx-talk").status).toBe("compatible");
    expect(classTaggingStatus("acmart").status).toBe("partially-compatible");
    expect(classTaggingStatus("amsart").status).toBe("partially-compatible");
    expect(classTaggingStatus("IEEEtran").status).toBe("currently-incompatible");
    expect(classTaggingStatus("revtex4-2").status).toBe("currently-incompatible");
    expect(classTaggingStatus("scrartcl").status).toBe("currently-incompatible");
    expect(classTaggingStatus("memoir").status).toBe("currently-incompatible");
    expect(classTaggingStatus("beamer").status).toBe("no-support");
  });

  it("reports an unrecorded class as unknown rather than guessing", () => {
    expect(classTaggingStatus("not-a-real-class").status).toBe("unknown");
  });

  it("matches the upstream verdicts for packages", () => {
    expect(packageTaggingStatus("float").status).toBe("currently-incompatible");
    expect(packageTaggingStatus("caption").status).toBe("currently-incompatible");
    expect(packageTaggingStatus("subcaption").status).toBe("currently-incompatible");
    expect(packageTaggingStatus("algorithm2e").status).toBe("currently-incompatible");
    expect(packageTaggingStatus("listings").status).toBe("currently-incompatible");
    expect(packageTaggingStatus("minted").status).toBe("currently-incompatible");
    expect(packageTaggingStatus("enumitem").status).toBe("partially-compatible");
    expect(packageTaggingStatus("hyperref").status).toBe("partially-compatible");
    expect(packageTaggingStatus("booktabs").status).toBe("compatible");
    expect(packageTaggingStatus("babel").status).toBe("unchecked");
  });

  it("reports a package with no upstream record as unknown, never as compatible", () => {
    expect(packageTaggingStatus("not-a-real-package").status).toBe("unknown");
    expect(packageTaggingStatus("oleafly-invented-package").status).toBe("unknown");
  });

  it("keeps the Oleafly restriction out of the upstream reading and inside the verdict", () => {
    expect(packageTaggingStatus("enumitem").status).toBe("partially-compatible");
    const verdict = packageTaggingVerdict("enumitem");
    expect(verdict.status).toBe("currently-incompatible");
    expect(verdict.restricted).toBe(true);
    expect(verdict.note).toContain("Oleafly");
    expect(packageTaggingVerdict("booktabs").restricted).toBeUndefined();
  });
});

describe("source parsing", () => {
  it("finds the document class and the loaded packages", () => {
    const source = "\\documentclass[11pt]{IEEEtran}\n\\usepackage{float,caption}\n\\RequirePackage[x]{minted}";
    expect(documentClassOf(source)).toBe("IEEEtran");
    expect(loadedPackagesOf(source).sort()).toEqual(["caption", "float", "minted"]);
  });

  it("returns null when there is no document class", () => {
    expect(documentClassOf("plain prose")).toBeNull();
  });
});

describe("taggingGate", () => {
  it("blocks an incompatible class and names it", () => {
    const gate = taggingGate("\\documentclass{IEEEtran}");
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toContain("IEEEtran");
    expect(gate.reason).toContain("not compatible with LaTeX tagging yet");
  });

  it("blocks a class the LaTeX Project will not support and points at the successor", () => {
    const gate = taggingGate("\\documentclass{beamer}");
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toContain("ltx-talk");
  });

  it("warns about a partially compatible class without blocking", () => {
    const gate = taggingGate("\\documentclass{acmart}");
    expect(gate.blocked).toBe(false);
    expect(gate.cautioned).toBe(true);
    expect(gate.reason).toContain("only partly compatible");
  });

  it("lets a compatible class through and lists the packages that will not tag", () => {
    const gate = taggingGate("\\documentclass{article}\n\\usepackage{float}\n\\usepackage{amsmath}");
    expect(gate.blocked).toBe(false);
    expect(gate.cautioned).toBe(false);
    expect(gate.reason).toBeNull();
    expect(gate.incompatiblePackages.map((entry) => entry.name)).toEqual(["float"]);
    expect(gate.partialPackages.map((entry) => entry.name)).toEqual(["amsmath"]);
    expect(gate.unknownPackages).toEqual([]);
  });

  it("treats a package with no recorded verdict as a caution, not as compatible", () => {
    const gate = taggingGate("\\documentclass{article}\n\\usepackage{oleafly-invented-package}");
    expect(gate.blocked).toBe(false);
    expect(gate.incompatiblePackages).toEqual([]);
    expect(gate.unknownPackages.map((entry) => entry.name)).toEqual(["oleafly-invented-package"]);
  });

  it("applies the Oleafly enumitem restriction to the gate", () => {
    const gate = taggingGate("\\documentclass{article}\n\\usepackage{enumitem}");
    expect(gate.incompatiblePackages.map((entry) => entry.name)).toEqual(["enumitem"]);
    expect(gate.partialPackages).toEqual([]);
  });

  it("ignores a commented-out class and reads the one that is really active", () => {
    const gate = taggingGate("% \\documentclass{IEEEtran}\n\\documentclass{article}\n% \\usepackage{float}");
    expect(gate.blocked).toBe(false);
    expect(gate.documentClass?.name).toBe("article");
    expect(gate.incompatiblePackages).toEqual([]);
  });

  it("flags an unrecorded class as unproven rather than blocking it", () => {
    const gate = taggingGate("\\documentclass{some-private-class}");
    expect(gate.blocked).toBe(false);
    expect(gate.cautioned).toBe(true);
    expect(gate.reason).toContain("has not recorded a tagging status");
  });
});

const YAML_ENTRY = (name: string, type: string, status: string) =>
  `- name: ${name}\n  type: ${type}\n  status: ${status}\n`;

function upstreamShaped(overrides: string[] = []): string {
  const bulk: string[] = [];
  const fill = (prefix: string, count: number, status: string) => {
    for (let i = 0; i < count; i++) bulk.push(YAML_ENTRY(`${prefix}${i}`, "package", status));
  };
  for (let i = 0; i < 84; i++) bulk.push(YAML_ENTRY(`cls${i}`, "class", "compatible"));
  bulk.push(YAML_ENTRY("IEEEtran", "class", "currently-incompatible"));
  fill("compat", 912, "compatible");
  bulk.push(YAML_ENTRY("booktabs", "package", "compatible"));
  fill("partial", 295, "partially-compatible");
  fill("incompat", 474, "currently-incompatible");
  bulk.push(YAML_ENTRY("float", "package", "currently-incompatible"));
  fill("nosupport", 53, "no-support");
  fill("unchecked", 165, "unchecked");
  return [...bulk, ...overrides].join("");
}

describe("update-tagging-status refresh script", () => {
  const build = (yaml: string) => {
    const entries = validateEntries(parseTaggingStatusYaml(yaml));
    return validateCatalog(buildCatalog(entries, "2026-09-11"), entries);
  };

  it("accepts an upstream-shaped file and keeps every category", () => {
    const built = build(upstreamShaped());
    expect(built.counts.classes).toBe(85);
    expect(built.counts["packages:compatible"]).toBe(913);
    expect(built.counts["packages:unchecked"]).toBe(165);
    expect(built.packages.compatible).toContain("booktabs");
  });

  it("refuses a file whose entries carry an unknown type", () => {
    expect(() => build(upstreamShaped([YAML_ENTRY("weird", "spreadsheet", "compatible")]))).toThrow(
      /unknown type/,
    );
  });

  it("refuses a file whose entries carry an unknown status", () => {
    expect(() => build(upstreamShaped([YAML_ENTRY("weird", "package", "probably-fine")]))).toThrow(
      /unknown status/,
    );
  });

  it("refuses an unusable entry name", () => {
    expect(() => build(upstreamShaped([YAML_ENTRY('"', "package", "compatible")]))).toThrow(
      /unusable entry name/,
    );
  });

  it("refuses duplicate entries", () => {
    expect(() => build(upstreamShaped([YAML_ENTRY("booktabs", "package", "compatible")]))).toThrow(
      /duplicate entry/,
    );
  });

  it("refuses a catalog that lost a whole category", () => {
    const thin: string[] = [];
    for (let i = 0; i < 1600; i++) thin.push(YAML_ENTRY(`incompat${i}`, "package", "currently-incompatible"));
    thin.push(YAML_ENTRY("float", "package", "currently-incompatible"));
    thin.push(YAML_ENTRY("IEEEtran", "class", "currently-incompatible"));
    thin.push(YAML_ENTRY("booktabs", "package", "compatible"));
    expect(() => build(thin.join(""))).toThrow(/expected at least/);
  });

  it("refuses a file that is far too small to be the upstream list", () => {
    expect(() => build(YAML_ENTRY("float", "package", "currently-incompatible"))).toThrow(
      /only 1 entries parsed/,
    );
  });
});
