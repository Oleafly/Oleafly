import { hasTypstBibliography } from "@/lib/citation/typst-bibliography";

export function ensureTypstBibliography(source: string, path: string): string {
  if (hasTypstBibliography(source)) return source;
  const safePath = path.replaceAll("\\", "/").replaceAll('"', String.raw`\"`);
  return `${source.trimEnd()}\n\n#bibliography("${safePath}")\n`;
}

export function ensureMarkdownBibliography(source: string, path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const declaration = `bibliography: ${JSON.stringify(normalizedPath)}`;
  const frontMatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!frontMatter) return `---\n${declaration}\n---\n\n${source}`;
  if (/^bibliography\s*:/m.test(frontMatter[1])) return source;
  const closingOffset = frontMatter[0].lastIndexOf("---");
  return `${source.slice(0, closingOffset)}${declaration}\n${source.slice(closingOffset)}`;
}

function unquoteYamlScalar(value: string): string | null {
  const withoutComment = value.replace(/(?<!\s)\s+#.*$/, "").trim();
  if (!withoutComment) return null;
  if (withoutComment.startsWith('"') && withoutComment.endsWith('"')) {
    try {
      const parsed = JSON.parse(withoutComment);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (withoutComment.startsWith("'") && withoutComment.endsWith("'")) {
    return withoutComment.slice(1, -1).replaceAll("''", "'");
  }
  return withoutComment;
}

export function markdownBibliographyPaths(source: string): string[] {
  const frontMatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!frontMatter) return [];
  const lines = frontMatter[1].split(/\r?\n/);
  const declaration = lines.findIndex((line) => /^bibliography\s*:/.test(line));
  if (declaration < 0) return [];
  const value = lines[declaration].replace(/^bibliography\s*:\s*/, "").trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map(unquoteYamlScalar)
      .filter((path): path is string => Boolean(path));
  }
  const scalar = unquoteYamlScalar(value);
  if (scalar) return [scalar];

  const paths: string[] = [];
  for (const line of lines.slice(declaration + 1)) {
    const item = /^\s*-\s+(?=\S|$)(?=((?:\S(?:.*\S)?)?))\1\s*$/.exec(line);
    if (item) {
      const path = unquoteYamlScalar(item[1]);
      if (path) paths.push(path);
      continue;
    }
    if (!/^\s/.test(line)) break;
  }
  return paths;
}
