import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { documentStats, type DocumentStats } from "@/lib/document-stats";

interface ExpectedFile {
  path: string;
  stats: DocumentStats;
}

const root = path.join(process.cwd(), "src-tauri/src/fixtures/document-stats");
const fixtures = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("document stats golden fixtures shared with the Rust counter", () => {
  it.each(fixtures)("%s counts every file the same way", (name) => {
    const expected = JSON.parse(
      readFileSync(path.join(root, name, "expected.json"), "utf8"),
    ) as { files: ExpectedFile[] };
    for (const file of expected.files) {
      const text = readFileSync(path.join(root, name, "project", file.path), "utf8");
      expect({ path: file.path, stats: documentStats(text) }).toEqual(file);
    }
  });
});
