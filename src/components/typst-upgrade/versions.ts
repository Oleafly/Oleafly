import type { DocumentEngineDescriptor, TypstToolchainStatus } from "@/lib/tauri";

function parts(version: string): { numbers: number[]; prerelease: string | null } {
  const [core, ...rest] = version.trim().replace(/^v/i, "").split("-");
  return {
    numbers: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease: rest.length > 0 ? rest.join("-") : null,
  };
}

export function compareTypstVersions(left: string, right: string): number {
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index++) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

export function newerInstalledTypstVersions(
  status: TypstToolchainStatus | null | undefined,
  current: string | null,
): string[] {
  if (!status || !current) return [];
  return status.versions
    .filter((entry) => entry.sources.length > 0 && compareTypstVersions(entry.version, current) > 0)
    .map((entry) => entry.version)
    .sort((first, second) => compareTypstVersions(second, first));
}

export function projectTypstVersion(
  engine: Pick<DocumentEngineDescriptor, "typst_version" | "typst_resolved">,
  status: TypstToolchainStatus | null | undefined,
): string | null {
  return engine.typst_resolved?.version ?? engine.typst_version ?? status?.defaultVersion ?? null;
}
