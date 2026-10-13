const ELLIPSIS = "…";

export function middleEllipsisPath(path: string, max: number): string {
  if (path.length <= max) return path;
  const folders = path.split("/");
  const name = folders.pop() ?? path;
  if (folders.length === 0) return path;
  const [first, ...inner] = folders;
  const keepFirst = inner.length > 0 && `${first}/${ELLIPSIS}/${name}`.length <= max;
  const head = keepFirst ? `${first}/` : "";
  const candidates = keepFirst ? inner : folders;
  let tail = name;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const next = `${candidates[index]}/${tail}`;
    if (`${head}${ELLIPSIS}/${next}`.length > max) break;
    tail = next;
  }
  return `${head}${ELLIPSIS}/${tail}`;
}
