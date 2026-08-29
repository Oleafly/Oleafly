#!/usr/bin/env node
// Guards the design-token migration: surfaces listed in MIGRATED must not
// hardcode hex colors; they read --oleafly-* tokens (via Tailwind utilities
// or CSS vars) instead. Grow MIGRATED as surfaces are converted.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

const ROOT = new URL("..", import.meta.url).pathname;

const MIGRATED = [
  "src/components/ui",
  "src/components/ErrorBoundary.tsx",
  "src/components/layout/BackendProtocolBanner.tsx",
  "src/components/ai/chat-parts.tsx",
  "src/lib/theme.tsx",
];

// The transparency checkerboard in the color picker is a pattern, not a
// palette choice, and its default swatch value is data.
const ALLOWED = new Set(["src/components/ui/color-picker.tsx"]);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function* walk(path) {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path)) yield* walk(join(path, entry));
    return;
  }
  if (/\.(tsx?|css)$/.test(path) && !/\.test\.tsx?$/.test(path)) yield path;
}

let failures = 0;
for (const target of MIGRATED) {
  for (const file of walk(join(ROOT, target))) {
    const rel = relative(ROOT, file);
    if (ALLOWED.has(rel)) continue;
    const source = readFileSync(file, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      const hits = line.match(HEX);
      if (!hits) continue;
      failures++;
      console.error(`${rel}:${index + 1}: hardcoded color ${hits.join(", ")}`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} hardcoded color(s) in migrated surfaces.`);
  process.exit(1);
}
console.log("No hardcoded colors in migrated surfaces.");
