import { describe, expect, it } from "vitest";
import { summarizeOperatorFulfillmentQueue } from "@/lib/justice/operatorFulfillmentQueue";

describe("summarizeOperatorFulfillmentQueue", () => {
  it("reports zero depth and null age for an empty queue", () => {
    const metrics = summarizeOperatorFulfillmentQueue([], Date.parse("2026-07-18T12:00:00.000Z"));
    expect(metrics).toEqual({
      total_unworked: 0,
      oldest_created_at: null,
      oldest_age_ms: null,
    });
  });

  it("counts unworked tasks and measures the oldest wait", () => {
    const now = Date.parse("2026-07-18T12:00:00.000Z");
    const metrics = summarizeOperatorFulfillmentQueue(
      [
        { created_at: "2026-07-18T11:30:00.000Z" }, // 30 min
        { created_at: "2026-07-18T09:00:00.000Z" }, // 3 h (oldest)
        { created_at: "2026-07-18T11:55:00.000Z" }, // 5 min
      ],
      now
    );
    expect(metrics.total_unworked).toBe(3);
    expect(metrics.oldest_created_at).toBe("2026-07-18T09:00:00.000Z");
    expect(metrics.oldest_age_ms).toBe(3 * 60 * 60 * 1000);
  });

  it("ignores unparseable / missing timestamps but still counts them in depth", () => {
    const now = Date.parse("2026-07-18T12:00:00.000Z");
    const metrics = summarizeOperatorFulfillmentQueue(
      [{ created_at: null }, { created_at: "not-a-date" }, { created_at: "2026-07-18T11:00:00.000Z" }],
      now
    );
    expect(metrics.total_unworked).toBe(3);
    expect(metrics.oldest_created_at).toBe("2026-07-18T11:00:00.000Z");
    expect(metrics.oldest_age_ms).toBe(60 * 60 * 1000);
  });

  it("never returns a negative age when a timestamp is slightly in the future", () => {
    const now = Date.parse("2026-07-18T12:00:00.000Z");
    const metrics = summarizeOperatorFulfillmentQueue(
      [{ created_at: "2026-07-18T12:05:00.000Z" }],
      now
    );
    expect(metrics.oldest_age_ms).toBe(0);
  });
});
