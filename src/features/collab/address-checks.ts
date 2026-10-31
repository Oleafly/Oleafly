const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;
const SPACE_OR_CONTROL = /[\s\p{Cc}]/u;

function withoutTrailingDots(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === ".") end -= 1;
  return text.slice(0, end);
}

export function looksLikeDomain(value: string): boolean {
  const domain = withoutTrailingDots(value.trim().replace(/^@+/, "")).toLowerCase();
  if (domain === "" || domain.length > 253 || !domain.includes(".")) return false;
  return domain.split(".").every((label) => label.length > 0 && label.length <= 63 && LABEL.test(label));
}

export function looksLikeEmailAddress(value: string): boolean {
  const email = value.trim();
  const at = email.indexOf("@");
  if (at < 1 || email.includes("@", at + 1)) return false;
  return !SPACE_OR_CONTROL.test(email.slice(0, at)) && looksLikeDomain(email.slice(at + 1));
}

export function looksLikeLogin(value: string): boolean {
  const login = value.trim().replace(/^@+/, "");
  return login !== "" && Array.from(login).length <= 100 && !SPACE_OR_CONTROL.test(login);
}
