import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligenceResult } from "./assemble";
import { isProjectIntelligencePath } from "./source";
import type { FileAnalysis } from "./types";

const SEEDS = fileURLToPath(
  new URL("../../../fixtures/research-seeds/", import.meta.url),
);

function walk(directory: string, out: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

export function loadSeedSources(slug: string): Record<string, string> {
  const root = path.join(SEEDS, slug);
  const paths: string[] = [];
  walk(root, paths);
  const sources: Record<string, string> = {};
  for (const full of paths.sort()) {
    const relative = path.relative(root, full).split(path.sep).join("/");
    if (!isProjectIntelligencePath(relative)) continue;
    sources[relative] = fs.readFileSync(full, "utf8");
  }
  return sources;
}

export function analyzeSeedProject(slug: string) {
  const sources = loadSeedSources(slug);
  const files: Record<string, FileAnalysis> = {};
  for (const [file, text] of Object.entries(sources)) {
    files[file] = analyzeProjectFile(file, text, 1);
  }
  const assembled = assembleProjectIntelligenceResult({
    identity: { projectId: "golden", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources).sort(),
    mainDocument: "main.tex",
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: Object.values(sources).reduce(
        (sum, text) => sum + text.length,
        0,
      ),
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
  return { sources, files, ...assembled };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
