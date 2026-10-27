const CONCURRENCY = 6;

export async function forEachLimited<T>(
  items: readonly T[],
  run: (item: T) => Promise<unknown>,
): Promise<{ succeeded: T[]; failed: T[] }> {
  const succeeded: T[] = [];
  const failed: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await run(item);
        succeeded.push(item);
      } catch {
        failed.push(item);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker),
  );
  return { succeeded, failed };
}
