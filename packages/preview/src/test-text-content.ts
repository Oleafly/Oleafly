async function readChunksInto<T>(
  reader: ReadableStreamDefaultReader<{ items: T[] }>,
  items: T[],
): Promise<void> {
  const chunk = await reader.read();
  if (chunk.done) return;
  items.push(...chunk.value.items);
  await readChunksInto(reader, items);
}

export async function readTextContentItems<T>(
  source: ReadableStream<{ items: T[] }>,
): Promise<T[]> {
  const reader = source.getReader();
  const items: T[] = [];
  await readChunksInto(reader, items);
  return items;
}
