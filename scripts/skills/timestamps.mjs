export const CANONICAL_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export function packVersionDate(version) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})(?:[.-].*)?$/.exec(version ?? "");
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function formatStamp(epochMs) {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function floorGeneratedAt(packVersion) {
  const date = packVersionDate(packVersion);
  if (!date) return formatStamp(Date.now());
  return `${date}T00:00:00Z`;
}

export function shelfGeneratedAt({ packVersion, pinDate }) {
  const floorMs = Date.parse(floorGeneratedAt(packVersion));
  const pinMs = pinDate ? Date.parse(pinDate) : Number.NaN;
  const candidate = Number.isNaN(pinMs) ? floorMs + DAY_MS : Math.max(pinMs, floorMs + DAY_MS);
  return formatStamp(candidate);
}

export function assertShelfNewerThanFloor(shelfGenerated, floorGenerated) {
  for (const [label, stamp] of [
    ["shelf catalog", shelfGenerated],
    ["bundled floor", floorGenerated],
  ]) {
    if (!CANONICAL_STAMP.test(stamp)) {
      throw new Error(
        `${label} generatedAt "${stamp}" is not in YYYY-MM-DDTHH:MM:SSZ form; the app compares these stamps as strings, so mixed precision can invert the ordering`,
      );
    }
  }
  const shelfMs = Date.parse(shelfGenerated);
  const floorMs = Date.parse(floorGenerated);
  if (!(shelfMs > floorMs) || !(shelfGenerated > floorGenerated)) {
    throw new Error(
      `shelf catalog generatedAt ${shelfGenerated} is not strictly newer than the bundled floor ${floorGenerated}; the app would discard the shelf catalog and show only bundled skills`,
    );
  }
}
