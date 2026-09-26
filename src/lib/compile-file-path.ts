function normalizeCompilePath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== ".")
    .join("/")
    .normalize("NFC");
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function lookupVariants(path: string): string[] {
  return /\.[^./]+$/.test(basename(path)) ? [path] : [path, `${path}.tex`];
}

type KnownPath = readonly [candidate: string, name: string];

function exactMatch(known: readonly KnownPath[], variants: string[]): string | undefined {
  for (const variant of variants) {
    const exact = known.find(([, name]) => name === variant);
    if (exact) return exact[0];
  }
  return undefined;
}

function containingMatch(known: readonly KnownPath[], variants: string[]): string | undefined {
  for (const variant of variants) {
    const containing = known
      .filter(([, name]) => variant.endsWith(`/${name}`))
      .sort((a, b) => b[1].length - a[1].length);
    if (containing.length > 0) return containing[0][0];
  }
  return undefined;
}

function uniqueMatch(
  known: readonly KnownPath[],
  variants: string[],
  matches: (name: string, variant: string) => boolean,
): string | null | undefined {
  for (const variant of variants) {
    const found = known.filter(([, name]) => matches(name, variant));
    if (found.length === 1) return found[0][0];
    if (found.length > 1) return null;
  }
  return undefined;
}

export function compilePathResolver(
  candidates: readonly string[],
): (path: string) => string | null {
  const known = [...new Set(candidates)].map(
    (candidate): KnownPath => [candidate, normalizeCompilePath(candidate)],
  );
  return (path) => {
    const wanted = normalizeCompilePath(path);
    if (!wanted) return null;
    const variants = lookupVariants(wanted);
    const direct = exactMatch(known, variants) ?? containingMatch(known, variants);
    if (direct !== undefined) return direct;
    const nested = uniqueMatch(known, variants, (name, variant) => name.endsWith(`/${variant}`));
    if (nested !== undefined) return nested;
    if (wanted.includes("/")) return null;
    return uniqueMatch(known, variants, (name, variant) => basename(name) === variant) ?? null;
  };
}

export function resolveCompilePath(
  path: string,
  candidates: readonly string[],
): string | null {
  return compilePathResolver(candidates)(path);
}
