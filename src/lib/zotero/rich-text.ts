const MARKUP = /<\/?(?:i|b|em|strong|u|sub|sup|sc|small)>|<(?:span|a)(?:\s[^<>]*)?>|<\/(?:span|a)>|<br\s*\/?>/gi;
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

export function plainText(text: string): string {
  return text
    .replace(MARKUP, "")
    .replace(ENTITY, decodeEntity)
    .replace(/\s+/g, " ")
    .trim();
}
