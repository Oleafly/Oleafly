const MARKUP_TAGS: readonly RegExp[] = [
  /^<\/?(?:i|b|em|strong|u|sub|sup|sc|small)>$/i,
  /^<(?:span|a)(?:\s[^<>]*)?>$/i,
  /^<\/(?:span|a)>$/i,
  /^<br\s*\/?>$/i,
];
const ENTITY = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g;
const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

function decodeEntity(entity: string, decimal?: string, hex?: string, name?: string): string {
  if (name) return NAMED[name] ?? entity;
  const code = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? "", 16);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
}

function isMarkupTag(tag: string): boolean {
  return MARKUP_TAGS.some((pattern) => pattern.test(tag));
}

function withoutMarkupTags(text: string): string {
  let result = "";
  let index = 0;
  for (let open = text.indexOf("<"); open !== -1; open = text.indexOf("<", index)) {
    const close = text.indexOf(">", open + 1);
    if (close === -1) break;
    const start = text.lastIndexOf("<", close);
    const tag = text.slice(start, close + 1);
    result += text.slice(index, start);
    if (!isMarkupTag(tag)) result += tag;
    index = close + 1;
  }
  return result + text.slice(index);
}

export function plainText(text: string): string {
  return withoutMarkupTags(text)
    .replace(ENTITY, decodeEntity)
    .replace(/\s+/g, " ")
    .trim();
}
