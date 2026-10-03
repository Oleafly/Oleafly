import { describe, expect, it } from "vitest";
import type { DocumentEngineDescriptor, TypstToolchainStatus } from "@/lib/tauri";
import { compareTypstVersions, newerInstalledTypstVersions, projectTypstVersion } from "./versions";

const status: TypstToolchainStatus = {
  bundledVersion: "0.15.1",
  defaultVersion: "0.15.1",
  defaultChoice: null,
  system: null,
  installing: null,
  versions: [
    { version: "0.15.1", releasedAt: null, inCatalog: true, sources: ["bundled"], downloadBytes: null },
    { version: "0.15.0-rc.1", releasedAt: null, inCatalog: false, sources: ["system"], downloadBytes: null },
    { version: "0.14.2", releasedAt: null, inCatalog: true, sources: ["downloaded"], downloadBytes: null },
    { version: "0.14.0", releasedAt: null, inCatalog: true, sources: [], downloadBytes: null },
    { version: "0.13.1", releasedAt: null, inCatalog: true, sources: ["downloaded"], downloadBytes: null },
  ],
};

describe("Typst upgrade versions", () => {
  it("orders versions numerically and puts prereleases first", () => {
    expect(compareTypstVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareTypstVersions("0.15.0-rc.1", "0.15.0")).toBeLessThan(0);
    expect(compareTypstVersions("0.14.2", "0.14.2")).toBe(0);
  });

  it("offers only installed versions newer than the project's, newest first", () => {
    expect(newerInstalledTypstVersions(status, "0.13.1")).toEqual(["0.15.1", "0.15.0-rc.1", "0.14.2"]);
    expect(newerInstalledTypstVersions(status, "0.15.1")).toEqual([]);
    expect(newerInstalledTypstVersions(null, "0.13.1")).toEqual([]);
  });

  it("reads the version a project compiles with", () => {
    const engine = { typst_version: "0.13.1", typst_resolved: { version: "0.13.1", source: "downloaded" } };
    expect(projectTypstVersion(engine as DocumentEngineDescriptor, status)).toBe("0.13.1");
    const unpinned = { typst_version: null, typst_resolved: null };
    expect(projectTypstVersion(unpinned as DocumentEngineDescriptor, status)).toBe("0.15.1");
    expect(projectTypstVersion(unpinned as DocumentEngineDescriptor, null)).toBeNull();
  });
});
