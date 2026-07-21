import { describe, expect, it } from "vitest";
import {
  categorizeOwnedFilingFtcStageError,
  createOwnedFilingFtcStageTiming,
} from "@/lib/justice/ownedFilingFtcStageTiming";

describe("categorizeOwnedFilingFtcStageError", () => {
  it("maps known failures to short categories without leaking payloads", () => {
    expect(
      categorizeOwnedFilingFtcStageError(
        new Error("owned-filing playwright evaluate_timeout after 45000ms")
      )
    ).toBe("evaluate_timeout");
    expect(
      categorizeOwnedFilingFtcStageError(
        new Error("page.evaluate: Target page, context or browser has been closed")
      )
    ).toBe("target_closed");
    expect(
      categorizeOwnedFilingFtcStageError(new Error("browser has been disconnected"))
    ).toBe("browser_disconnected");
    expect(
      categorizeOwnedFilingFtcStageError(
        new Error("owned-filing decide_timeout after 60000ms")
      )
    ).toBe("decide_timeout");
    expect(
      categorizeOwnedFilingFtcStageError(
        new Error("owned-filing action_timeout after 20000ms")
      )
    ).toBe("action_timeout");
    expect(
      categorizeOwnedFilingFtcStageError(
        Object.assign(new Error("Timeout 15000ms exceeded."), { name: "TimeoutError" })
      )
    ).toBe("timeout");
  });

  it("never echoes emails, tokens, HTML, or form values", () => {
    const category = categorizeOwnedFilingFtcStageError(
      new Error(
        'fill failed value=secret-token-abc email=pat@example.com <html><body>Never arrived</body></html> password=hunter2'
      )
    );
    expect(category).toBe("error");
    expect(category).not.toContain("@");
    expect(category).not.toContain("secret");
    expect(category).not.toContain("html");
    expect(category).not.toContain("hunter");
    expect(category).not.toContain("Never arrived");
  });
});

describe("createOwnedFilingFtcStageTiming", () => {
  it("records completed stages with duration_ms and ok", async () => {
    const timing = createOwnedFilingFtcStageTiming();
    await timing.run("connect_cdp", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "browser";
    });
    await timing.run("open_session", async () => "session");

    const timeline = timing.formatTimeline();
    expect(timeline).toMatch(/stages=connect_cdp:\d+ms:ok;open_session:\d+ms:ok/);
    expect(timing.getRecords()).toHaveLength(2);
    expect(timing.getRecords()[0]?.ok).toBe(true);
    expect(timing.getRecords()[0]?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(timing.formatTimeline()).toMatch(/connect_cdp:\d+ms:ok/);
  });

  it("records failed stages with sanitized error_category", async () => {
    const timing = createOwnedFilingFtcStageTiming();
    await expect(
      timing.run("evaluate_1", async () => {
        throw new Error("page.evaluate: Target page, context or browser has been closed");
      })
    ).rejects.toThrow(/target page/i);

    const timeline = timing.formatTimeline();
    expect(timeline).toContain("evaluate_1:");
    expect(timeline).toContain("fail:target_closed");
    expect(timeline).not.toContain("page.evaluate");
    expect(timing.getRecords()[0]).toMatchObject({
      stage: "evaluate_1",
      ok: false,
      error_category: "target_closed",
    });
  });

  it("identifies decide_1 and apply_1 failures without sensitive action data", async () => {
    const timing = createOwnedFilingFtcStageTiming();
    await expect(
      timing.run("decide_1", async () => {
        throw new Error(
          "owned-filing decide_timeout after 60000ms private@example.com sensitive story"
        );
      })
    ).rejects.toThrow("decide_timeout");
    await expect(
      timing.run("apply_1", async () => {
        throw new Error(
          "owned-filing action_timeout after 20000ms value=secret-case-content"
        );
      })
    ).rejects.toThrow("action_timeout");

    const timeline = timing.formatTimeline();
    expect(timeline).toMatch(/decide_1:\d+ms:fail:decide_timeout/);
    expect(timeline).toMatch(/apply_1:\d+ms:fail:action_timeout/);
    expect(timeline).not.toContain("private@example.com");
    expect(timeline).not.toContain("sensitive story");
    expect(timeline).not.toContain("secret-case-content");
  });

  it("attributes an in-progress hung stage as active in the timeline", async () => {
    const timing = createOwnedFilingFtcStageTiming();
    timing.begin("ready_1");
    await new Promise((r) => setTimeout(r, 5));
    const timeline = timing.formatTimeline();
    expect(timeline).toMatch(/ready_1:\d+ms:active/);
    expect(timing.getActiveStage()).toBe("ready_1");
  });

  it("records retry stages after evaluate_1 timeout then evaluate_2 success", async () => {
    const timing = createOwnedFilingFtcStageTiming();
    await expect(
      timing.run("evaluate_1", async () => {
        throw new Error("owned-filing playwright evaluate_timeout after 45000ms");
      })
    ).rejects.toThrow(/evaluate_timeout/);

    await timing.run("retry_replace", async () => undefined);
    await timing.run("goto_2", async () => undefined);
    await timing.run("ready_2", async () => undefined);
    await timing.run("evaluate_2", async () => ({ fields: [] }));

    const timeline = timing.formatTimeline();
    expect(timeline).toContain("evaluate_1:");
    expect(timeline).toContain("fail:evaluate_timeout");
    expect(timeline).toContain("retry_replace:");
    expect(timeline).toContain("goto_2:");
    expect(timeline).toContain("ready_2:");
    expect(timeline).toMatch(/evaluate_2:\d+ms:ok/);
  });

  it("records close_during as the active stage when first close is observed", async () => {
    const timing = createOwnedFilingFtcStageTiming();
    await expect(
      timing.run(
        "evaluate_1",
        async () => {
          throw new Error("page.evaluate: Target page, context or browser has been closed");
        },
        () => ({ first_close_event: "page_close" })
      )
    ).rejects.toThrow(/target page/i);

    expect(timing.getCloseDuringStage()).toBe("evaluate_1");
    expect(timing.formatTimeline()).toContain("close_during=evaluate_1");
  });

  it("attaches a bounded stages timeline to thrown provider errors", () => {
    const timing = createOwnedFilingFtcStageTiming();
    timing.begin("goto_1");
    timing.endOk();
    timing.begin("evaluate_1");
    const attached = timing.attachToError(
      new Error(
        "owned-filing playwright evaluate target closed: original_error=page.evaluate: Target page, context or browser has been closed email=pat@example.com"
      )
    );
    expect(attached.message).toContain("stages=");
    expect(attached.message).toContain("goto_1:");
    expect(attached.message).toMatch(/evaluate_1:\d+ms:active/);
    expect(attached.message.length).toBeLessThanOrEqual(2000);
    // Timeline categories must not introduce form/HTML dumps; raw original may remain in base message
    const timelinePart = attached.message.split(" | stages=")[1] ?? "";
    expect(timelinePart).not.toContain("pat@example.com");
    expect(timelinePart).not.toContain("<html");
  });

  it("truncates an oversized timeline safely", async () => {
    const timing = createOwnedFilingFtcStageTiming();
    for (let i = 0; i < 9; i++) {
      const names = [
        "connect_cdp",
        "open_session",
        "goto_1",
        "ready_1",
        "evaluate_1",
        "retry_replace",
        "goto_2",
        "ready_2",
        "evaluate_2",
      ] as const;
      await timing.run(names[i]!, async () => undefined);
    }
    const timeline = timing.formatTimeline();
    expect(timeline.length).toBeLessThanOrEqual(700);
  });
});
