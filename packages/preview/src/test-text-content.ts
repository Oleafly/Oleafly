export async function readTextContentItems<T>(
  source: ReadableStream<{ items: T[] }>,
): Promise<T[]> {
  const reader = source.getReader();
  const items: T[] = [];
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    items.push(...chunk.value.items);
  }
  return items;
}
