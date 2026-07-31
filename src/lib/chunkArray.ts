/** Splits `items` into consecutive chunks of at most `size` elements each. */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return items.length === 0 ? [] : [items.slice()];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
