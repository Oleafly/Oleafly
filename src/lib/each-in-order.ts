export async function eachInOrder<T>(items: readonly T[], task: (item: T) => Promise<void>, from = 0): Promise<void> {
  if (from >= items.length) return;
  await task(items[from]);
  await eachInOrder(items, task, from + 1);
}
