import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_FILE = /\.(?:ts|tsx|mts)$/;
const WORKSPACE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](@oleafly\/[^"'?]+)/g;

interface Manifest {
  name: string;
  exports?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface Workspace {
  dir: string;
  sourceDir: string;
  manifest: Manifest;
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as Manifest;
}

const packages: Workspace[] = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "packages", entry.name, "package.json")))
  .map((entry) => {
    const dir = `packages/${entry.name}`;
    return { dir, sourceDir: `${dir}/src`, manifest: readManifest(dir) };
  });

const workspaces: Workspace[] = [{ dir: ".", sourceDir: "src", manifest: readManifest(".") }, ...packages];

const byName = new Map(packages.map((workspace) => [workspace.manifest.name, workspace]));

function sourceFiles(dir: string): string[] {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive: true, encoding: "utf8" })
    .filter((path) => SOURCE_FILE.test(path) && !path.includes("node_modules"))
    .map((path) => join(absolute, path));
}

function workspaceImports(workspace: Workspace): Set<string> {
  const specifiers = new Set<string>();
  for (const file of sourceFiles(workspace.sourceDir)) {
    for (const match of readFileSync(file, "utf8").matchAll(WORKSPACE_IMPORT)) {
      specifiers.add(match[1]);
    }
  }
  return specifiers;
}

function splitSpecifier(specifier: string): { name: string; subpath: string } {
  const [scope, name, ...rest] = specifier.split("/");
  return { name: `${scope}/${name}`, subpath: rest.length ? `./${rest.join("/")}` : "." };
}

const imports = new Map(workspaces.map((workspace) => [workspace, workspaceImports(workspace)]));

describe("workspace manifests", () => {
  it("finds the workspace packages and their imports", () => {
    expect(byName.has("@oleafly/editor")).toBe(true);
    expect(imports.get(workspaces[0])?.has("@oleafly/editor")).toBe(true);
  });

  it("declares every @oleafly package a workspace imports", () => {
    const undeclared: string[] = [];
    for (const [workspace, specifiers] of imports) {
      const declared = {
        ...workspace.manifest.dependencies,
        ...workspace.manifest.devDependencies,
      };
      for (const specifier of specifiers) {
        const { name } = splitSpecifier(specifier);
        if (name !== workspace.manifest.name && declared[name] !== "workspace:*") {
          undeclared.push(`${workspace.dir} -> ${name}`);
        }
      }
    }
    expect([...new Set(undeclared)].sort()).toEqual([]);
  });

  it("imports only subpaths the target package exports", () => {
    const unexported: string[] = [];
    for (const specifiers of imports.values()) {
      for (const specifier of specifiers) {
        const { name, subpath } = splitSpecifier(specifier);
        const target = byName.get(name);
        if (!target) {
          unexported.push(`${specifier} (no such workspace package)`);
        } else if (!target.manifest.exports?.[subpath]) {
          unexported.push(specifier);
        }
      }
    }
    expect([...new Set(unexported)].sort()).toEqual([]);
  });

  it("pins one pdfjs-dist version across the workspace", () => {
    const rootVersion = workspaces[0].manifest.dependencies?.["pdfjs-dist"];
    expect(rootVersion).toMatch(/^\d+\.\d+\.\d+$/);
    const pins = workspaces
      .map((workspace) => ({
        dir: workspace.dir,
        version: workspace.manifest.dependencies?.["pdfjs-dist"],
      }))
      .filter((pin) => pin.version !== undefined);
    expect(pins.length).toBeGreaterThan(1);
    expect(pins.filter((pin) => pin.version !== rootVersion)).toEqual([]);
  });
});
