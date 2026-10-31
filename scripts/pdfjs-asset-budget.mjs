import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PDFJS_ASSET_LIMITS = Object.freeze({
  standard_fonts: 820_000,
  wasm: 1_100_000,
  cmaps: 1_200_000,
  iccs: 15_500,
});

function asPath(dir) {
  return dir instanceof URL ? fileURLToPath(dir) : dir;
}

async function measureEntry(target, entry) {
  if (!entry.isDirectory()) return { files: 1, bytes: (await stat(target)).size };
  const files = (await readdir(target, { withFileTypes: true })).filter((file) => file.isFile());
  const sizes = await Promise.all(files.map(async (file) => (await stat(path.join(target, file.name))).size));
  return { files: files.length, bytes: sizes.reduce((total, size) => total + size, 0) };
}

export async function measurePdfjsAssets(pdfjsDir) {
  const root = asPath(pdfjsDir);
  const measured = {};
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return measured;
    throw error;
  }
  const sizes = await Promise.all(entries.map((entry) => measureEntry(path.join(root, entry.name), entry)));
  entries.forEach((entry, index) => {
    measured[entry.name] = sizes[index];
  });
  return measured;
}

export function pdfjsAssetFailures(measured, limits = PDFJS_ASSET_LIMITS) {
  const failures = [];
  for (const [folder, limit] of Object.entries(limits)) {
    const found = measured[folder];
    if (!found || found.files === 0) failures.push(`pdfjs/${folder} is missing; pdf.js needs it`);
    else if (found.bytes > limit) failures.push(`pdfjs/${folder} is ${found.bytes} bytes, over ${limit}`);
  }
  for (const folder of Object.keys(measured)) {
    if (!(folder in limits)) failures.push(`pdfjs/${folder} has no size limit; add it to the budget`);
  }
  return failures;
}

export function pdfjsAssetSummary(measured) {
  return Object.fromEntries(Object.entries(measured).map(([folder, { bytes }]) => [folder, bytes]));
}
