import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOwnedFilingFtcFormDecision,
  OWNED_FILING_FTC_DECIDE_TIMEOUT_MS,
} from "@/lib/justice/ownedFilingFtcDecision";

describe("fetchOwnedFilingFtcFormDecision", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("aborts a stuck decision fetch at 60 seconds with a sanitized category", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds: number) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("request timed out", "TimeoutError")),
        milliseconds
      );
      return controller.signal;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      })
    );

    const pending = fetchOwnedFilingFtcFormDecision(
      "https://app.example",
      { "content-type": "application/json" },
      { url: "https://reportfraud.ftc.gov", fields: [], buttons: [] },
      {
        email: "private@example.com",
        story: "sensitive case content",
      }
    );
    const assertion = expect(pending).rejects.toThrow(
      `owned-filing decide_timeout after ${OWNED_FILING_FTC_DECIDE_TIMEOUT_MS}ms`
    );

    await vi.advanceTimersByTimeAsync(OWNED_FILING_FTC_DECIDE_TIMEOUT_MS - 1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;

    const signalTimeout = vi.mocked(AbortSignal.timeout);
    expect(signalTimeout).toHaveBeenCalledWith(60_000);
    await pending.catch((err: Error) => {
      expect(err.message).not.toContain("private@example.com");
      expect(err.message).not.toContain("sensitive case content");
    });
  });

  it("does not retain sensitive decide-action error payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "private@example.com",
            raw: "sensitive case content",
          }),
          { status: 500 }
        )
      )
    );

    await expect(
      fetchOwnedFilingFtcFormDecision(
        "https://app.example",
        {},
        { url: "https://reportfraud.ftc.gov", fields: [], buttons: [] },
        {}
      )
    ).resolves.toEqual({
      ok: false,
      stopReason: "decide_action_failed",
      detail: "decide-action failed (500)",
    });
  });
});
