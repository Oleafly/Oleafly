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

export function compilePathResolver(
  candidates: readonly string[],
): (path: string) => string | null {
  const known = [...new Set(candidates)].map(
    (candidate) => [candidate, normalizeCompilePath(candidate)] as const,
  );
  return (path) => {
    const wanted = normalizeCompilePath(path);
    if (!wanted) return null;
    const variants = lookupVariants(wanted);
    for (const variant of variants) {
      const exact = known.find(([, name]) => name === variant);
      if (exact) return exact[0];
    }
    for (const variant of variants) {
      const containing = known
        .filter(([, name]) => variant.endsWith(`/${name}`))
        .sort((a, b) => b[1].length - a[1].length);
      if (containing.length > 0) return containing[0][0];
    }
    for (const variant of variants) {
      const nested = known.filter(([, name]) => name.endsWith(`/${variant}`));
      if (nested.length === 1) return nested[0][0];
      if (nested.length > 1) return null;
    }
    if (wanted.includes("/")) return null;
    for (const variant of variants) {
      const named = known.filter(([, name]) => basename(name) === variant);
      if (named.length === 1) return named[0][0];
      if (named.length > 1) return null;
    }
    return null;
  };
}

export function resolveCompilePath(
  path: string,
  candidates: readonly string[],
): string | null {
  return compilePathResolver(candidates)(path);
}
