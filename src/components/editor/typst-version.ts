export type TypstMinor = readonly [number, number];

export function typstMinorVersion(version: string | null | undefined): TypstMinor | null {
  const match = version ? /^v?(\d+)\.(\d+)/u.exec(version.trim()) : null;
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function typstVersionSupports(version: string | null | undefined, since: TypstMinor): boolean {
  const minor = typstMinorVersion(version);
  if (!minor) return true;
  return minor[0] > since[0] || (minor[0] === since[0] && minor[1] >= since[1]);
}

export const TYPST_FIGURE_ALT_SINCE: TypstMinor = [0, 14];
