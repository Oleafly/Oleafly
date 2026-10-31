import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { projectMapFromIndex } from "@oleafly/ai-tools";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligenceResult } from "./assemble";
import { legacyIndexFromProjectIntelligence } from "./legacy-index";
import { isProjectIntelligencePath } from "./source";
import type { FileAnalysis } from "./types";

const FIXTURES = fileURLToPath(
  new URL("../../../crates/oleafly-core/tests/fixtures/context/", import.meta.url),
);

function byCodePoint(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}

function walk(directory: string, out: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

function loadSources(root: string): Record<string, string> {
  const paths: string[] = [];
  walk(root, paths);
  paths.sort(byCodePoint);
  const sources: Record<string, string> = {};
  for (const full of paths) {
    const relative = path.relative(root, full).split(path.sep).join("/");
    if (relative === "fixture.json" || relative.startsWith("expected.")) continue;
    if (!isProjectIntelligencePath(relative)) continue;
    sources[relative] = fs.readFileSync(full, "utf8").replace(/\r\n?/gu, "\n");
  }
  return sources;
}

function projectMapFor(root: string) {
  const { main } = JSON.parse(fs.readFileSync(path.join(root, "fixture.json"), "utf8")) as { main: string };
  const sources = loadSources(root);
  const files: Record<string, FileAnalysis> = {};
  for (const [file, text] of Object.entries(sources)) {
    files[file] = analyzeProjectFile(file, text, 1);
  }
  const { snapshot } = assembleProjectIntelligenceResult({
    identity: { projectId: "golden", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources).sort(byCodePoint),
    mainDocument: main,
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: Object.values(sources).reduce((sum, text) => sum + text.length, 0),
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
  const map = projectMapFromIndex(legacyIndexFromProjectIntelligence(snapshot));
  return JSON.parse(JSON.stringify(map)) as unknown;
}

const cases = fs
  .readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort(byCodePoint);

describe("context goldens", () => {
  it.each(cases)("%s matches the app's project map", (name) => {
    const root = path.join(FIXTURES, name);
    const map = projectMapFor(root);
    const expectedPath = path.join(root, "expected.map.json");
    if (process.env.OLEAFLY_UPDATE_GOLDEN === "1") {
      fs.writeFileSync(expectedPath, `${JSON.stringify(map, null, 2)}\n`);
      return;
    }
    expect(map).toEqual(JSON.parse(fs.readFileSync(expectedPath, "utf8")));
  });
});
