export function preserveCase(matched: string, replacement: string): string {
  if (!matched || !replacement) return replacement;
  const lower = matched.toLowerCase();
  const upper = matched.toUpperCase();

  if (matched === upper && matched !== lower) return replacement.toUpperCase();
  if (matched === lower) return replacement.toLowerCase();
  if (matched[0] === matched[0].toUpperCase() && matched.slice(1) === matched.slice(1).toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
