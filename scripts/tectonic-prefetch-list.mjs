import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TECTONIC_PREFETCH_CAP = 512;

function prefetchLists(cacheDir) {
  const data = join(cacheDir, "bundles", "data");
  return readdirSync(data)
    .filter((name) => name.endsWith(".prefetch"))
    .map((name) => readFileSync(join(data, name), "utf8").split("\n").filter(Boolean));
}

export function rankPrefetchNames(lists, cap = TECTONIC_PREFETCH_CAP) {
  const ranked = new Map();
  for (const list of lists) {
    list.forEach((name, position) => {
      const entry = ranked.get(name) ?? { uses: 0, positions: 0 };
      entry.uses += 1;
      entry.positions += position;
      ranked.set(name, entry);
    });
  }
  return [...ranked.entries()]
    .sort(
      ([a, left], [b, right]) =>
        right.uses - left.uses ||
        left.positions / left.uses - right.positions / right.uses ||
        (a < b ? -1 : 1),
    )
    .slice(0, cap)
    .map(([name]) => name);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cacheDirs = process.argv.slice(2);
  if (cacheDirs.length === 0) {
    console.error("usage: node scripts/tectonic-prefetch-list.mjs <TECTONIC_CACHE_DIR>...");
    process.exit(2);
  }
  const lists = cacheDirs.flatMap(prefetchLists);
  process.stdout.write(`${rankPrefetchNames(lists).join("\n")}\n`);
}
