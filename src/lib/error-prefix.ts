export function errorStartsWith(error: unknown, prefix: string): boolean {
  const message = error instanceof Error ? error.message : error;
  return typeof message === "string" && message.startsWith(prefix);
}
