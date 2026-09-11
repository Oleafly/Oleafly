export interface DocumentMetadataMatch {
  body: string;
  start: number;
  end: number;
}

export function findDocumentMetadata(source: string): DocumentMetadataMatch | null {
  const head = /\\DocumentMetadata\s{0,20}\{/.exec(source);
  if (!head) return null;
  const open = head.index + head[0].length;
  let depth = 1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return { body: source.slice(open, i), start: head.index, end: i + 1 };
    }
  }
  return null;
}

export function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of body) {
    if (character === "{") depth++;
    if (character === "}") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

export interface MetadataKeys {
  order: string[];
  map: Map<string, string>;
}

export function parseMetadataKeys(body: string): MetadataKeys {
  const order: string[] = [];
  const map = new Map<string, string>();
  for (const part of splitTopLevel(body)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    if (!map.has(key)) order.push(key);
    map.set(key, value);
  }
  return { order, map };
}

export function serializeMetadataKeys({ order, map }: MetadataKeys): string {
  return order.map((key) => `${key}=${map.get(key)}`).join(",");
}

export function unwrapBraces(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
}
