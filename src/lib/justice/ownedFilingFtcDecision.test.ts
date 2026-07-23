import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDecideActionFailedDetail,
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

  it("preserves allowlisted openai_request_failed with upstream_status in step detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "openai_request_failed",
            upstream_status: 400,
            raw: "secret@example.com case story",
          }),
          { status: 500 }
        )
      )
    );

    const result = await fetchOwnedFilingFtcFormDecision(
      "https://app.example",
      {},
      { url: "https://reportfraud.ftc.gov", fields: [], buttons: [] },
      {}
    );

    expect(result).toEqual({
      ok: false,
      stopReason: "decide_action_failed",
      detail: "decide-action failed (500:openai_request_failed:upstream_400)",
    });
    expect(JSON.stringify(result)).not.toContain("secret@example.com");
    expect(JSON.stringify(result)).not.toContain("case story");
  });

  it("preserves empty_model_content in step detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "empty_model_content" }), { status: 500 })
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
      detail: "decide-action failed (500:empty_model_content)",
    });
  });

  it("preserves model_json_parse_failed in step detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "model_json_parse_failed" }), { status: 500 })
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
      detail: "decide-action failed (500:model_json_parse_failed)",
    });
  });

  it("preserves route_exception in step detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "route_exception" }), { status: 500 })
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
      detail: "decide-action failed (500:route_exception)",
    });
  });

  it("ignores non-allowlisted error strings and invalid upstream_status", async () => {
    expect(
      buildDecideActionFailedDetail(502, {
        error: "openai_request_failed",
        upstream_status: 999,
      })
    ).toBe("decide-action failed (502:openai_request_failed)");

    expect(
      buildDecideActionFailedDetail(500, {
        error: "not_a_real_category",
        upstream_status: 400,
      })
    ).toBe("decide-action failed (500)");
  });

  it("passes FTC structured mode from assistant and form-main mode from /form/main", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          decision: {
            fieldsToFill: [
              {
                selector: "sub-a",
                value: "Option A",
                controlKind: "radio",
                choiceSelectorType: "id",
              },
            ],
            nextButton: { selectorType: "text", value: "Continue" },
          },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchOwnedFilingFtcFormDecision(
      "https://app.example",
      { "content-type": "application/json" },
      { url: "https://reportfraud.ftc.gov/assistant", fields: [], buttons: [] },
      {}
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)).mode).toBe(
      "ftc_structured"
    );

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          decision: {
            fieldsToFill: [{ selector: "comments", value: "story" }],
            nextButton: { selectorType: "text", value: "Continue" },
          },
        }),
        { status: 200 }
      )
    );

    await fetchOwnedFilingFtcFormDecision(
      "https://app.example",
      { "content-type": "application/json" },
      { url: "https://reportfraud.ftc.gov/form/main", fields: [], buttons: [] },
      {}
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)).mode).toBe(
      "ftc_form_main"
    );
  });

  it("rejects malformed form/main decisions after a successful decide-action response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            decision: {
              fieldsToFill: [{ selector: "comments", value: 99 }],
              nextButton: { selectorType: "text", value: "Continue" },
            },
          }),
          { status: 200 }
        )
      )
    );

    const result = await fetchOwnedFilingFtcFormDecision(
      "https://app.example",
      {},
      { url: "https://reportfraud.ftc.gov/form/main", fields: [], buttons: [] },
      {}
    );
    expect(result).toEqual({
      ok: false,
      stopReason: "invalid_decision",
      detail: "decide-action returned an invalid decision shape",
    });
  });
});
