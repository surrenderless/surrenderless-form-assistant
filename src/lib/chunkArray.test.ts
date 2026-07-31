import { describe, expect, it } from "vitest";
import { chunkArray } from "@/lib/chunkArray";

describe("chunkArray", () => {
  it("returns an empty array for an empty input", () => {
    expect(chunkArray([], 20)).toEqual([]);
  });

  it("returns a single chunk when the input is smaller than the chunk size", () => {
    expect(chunkArray([1, 2, 3], 20)).toEqual([[1, 2, 3]]);
  });

  it("returns a single chunk when the input exactly equals the chunk size", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(chunkArray(items, 20)).toEqual([items]);
  });

  it("splits input larger than the chunk size into multiple chunks, preserving order", () => {
    // This is the exact scenario that caused chat transcript backfill to silently drop the
    // entire pre-commit conversation: more than MAX_JUSTICE_CASE_CHAT_APPEND_BATCH (20)
    // messages sent in a single request, which the server hard-rejects with no partial save.
    const items = Array.from({ length: 45 }, (_, i) => i);
    const chunks = chunkArray(items, 20);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks[1]).toHaveLength(20);
    expect(chunks[2]).toHaveLength(5);
    expect(chunks.flat()).toEqual(items);
  });

  it("does not mutate the input array", () => {
    const items = [1, 2, 3, 4, 5];
    const original = [...items];
    chunkArray(items, 2);
    expect(items).toEqual(original);
  });
});
