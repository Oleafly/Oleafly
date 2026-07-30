export function commandAliasSearchText(
  aliases: readonly string[] | undefined,
): string {
  if (!aliases?.length) return "";
  return aliases.flatMap((alias) => [alias, `/${alias}`]).join(" ");
}
