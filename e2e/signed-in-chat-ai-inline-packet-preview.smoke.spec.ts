import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  expectNoOptionalDestinationPrepOrEvidenceHubLinks,
  expectNoRequiredMainLadderOffChatLinks,
  expectUrlStaysOnChatAi,
} from "./helpers/chat-ai-ladder-continuity-e2e";
import {
  driveConsumerToSavedCaseForEvidenceUpload,
  uploadEvidenceFileViaChat,
} from "./helpers/chat-ai-evidence-upload-e2e";
import { chatAiTranscript } from "./helpers/chat-ai-owned-fulfillment-e2e";
import {
  CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE,
  CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE,
} from "@/lib/justice/chatLegalConsentGates";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("after evidence upload, consumer reviews draft and approves packet without leaving chat-ai", async ({
  page,
}) => {
  test.setTimeout(240_000);

  // TEMPORARY diagnostic: forward only [e2e-merge-diag-prefixed page console.log calls (added
  // at the two source-mapped PATCH sites in chat-ai/page.tsx, gated on the fixed Playwright
  // mock case id) directly to Node/CI output. Uses the live page "console" event rather than
  // Playwright's trace console capture, since that capture did not surface earlier diagnostics
  // that were later proven (via CDP breakpoints) to be on code paths that never executed —
  // this listens on the actual, now-confirmed-correct call sites instead. Forwards no other
  // console output.
  const MERGE_DIAG_PREFIX = "[e2e-merge-diag";
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.startsWith(MERGE_DIAG_PREFIX)) {
      console.log(text);
    }
  });

  // TEMPORARY diagnostic: set CDP breakpoints at the exact minified locations observed in
  // prior [e2e-fetch-diag] stacks for the two PATCH-issuing call sites inside the chat-ai
  // chunk, so a debugger pause captures CDP's own synchronous + async call-frame chain —
  // something plain Error().stack cannot see across await boundaries. Matched by URL regex,
  // not exact filename, since chunk hashes are non-deterministic across builds (proven
  // separately). Logs only function name, script URL, and line/column per frame — never
  // scopes, locals, arguments, or any request/user data (Debugger.paused's callFrames carry
  // a scopeChain/this we never read). Always resumes in a finally so a failure in the log
  // path can never leave the page paused and hang CI. Runs directly in Node (this CDP
  // session lives in the test process, not the page), so no exposeBinding relay is needed
  // for it. Must be wired before any navigation so breakpoints are armed before the chunk
  // that will hit them ever loads.
  const CHAT_AI_CHUNK_URL_REGEX = String.raw`_next/static/chunks/app/justice/chat-ai/page-[^/]+\.js`;
  const cdp = await page.context().newCDPSession(page);
  const scriptUrlsByScriptId = new Map<string, string>();
  cdp.on("Debugger.scriptParsed", (event) => {
    scriptUrlsByScriptId.set(event.scriptId, event.url);
  });
  await cdp.send("Debugger.enable");
  await cdp.send("Debugger.setAsyncCallStackDepth", { maxDepth: 32 });

  const cdpBreakpointTargets = new Map<string, number>();
  for (const columnNumber of [132791, 115671]) {
    const { breakpointId, locations } = await cdp.send("Debugger.setBreakpointByUrl", {
      urlRegex: CHAT_AI_CHUNK_URL_REGEX,
      lineNumber: 0,
      columnNumber,
    });
    cdpBreakpointTargets.set(breakpointId, columnNumber);
    console.log(
      `[e2e-cdp-diag] breakpoint-set target=${columnNumber} breakpointId=${breakpointId} locations=${JSON.stringify(locations)} time=${Date.now()}`
    );
  }

  cdp.on("Debugger.breakpointResolved", (event) => {
    console.log(
      `[e2e-cdp-diag] breakpoint-resolved target=${cdpBreakpointTargets.get(event.breakpointId) ?? "unknown"} breakpointId=${event.breakpointId} location=${JSON.stringify(event.location)} time=${Date.now()}`
    );
  });

  cdp.on("Debugger.paused", (event) => {
    void (async () => {
      try {
        const hitTargets = (event.hitBreakpoints ?? [])
          .map((id) => cdpBreakpointTargets.get(id))
          .filter((v): v is number => v !== undefined);

        const syncFrames = event.callFrames.map((frame) => {
          const url = scriptUrlsByScriptId.get(frame.location.scriptId) ?? frame.location.scriptId;
          return `${frame.functionName || "(anonymous)"} @ ${url}:${frame.location.lineNumber}:${frame.location.columnNumber ?? "?"}`;
        });

        const asyncFrames: string[] = [];
        let asyncStack = event.asyncStackTrace;
        while (asyncStack) {
          for (const frame of asyncStack.callFrames) {
            const url = frame.url || scriptUrlsByScriptId.get(frame.scriptId) || frame.scriptId;
            asyncFrames.push(
              `${frame.functionName || "(anonymous)"} @ ${url}:${frame.lineNumber}:${frame.columnNumber}`
            );
          }
          asyncStack = asyncStack.parent;
        }

        console.log(
          `[e2e-cdp-diag] paused target=${hitTargets.join(",") || "unknown"} time=${Date.now()}\n` +
            `sync:\n${syncFrames.map((f) => `  ${f}`).join("\n")}\n` +
            `async:\n${asyncFrames.length ? asyncFrames.map((f) => `  ${f}`).join("\n") : "  (none)"}`
        );
      } finally {
        await cdp.send("Debugger.resume").catch(() => {});
      }
    })();
  });

  // TEMPORARY diagnostic: capture the JS call stack of any fetch() that PATCHes
  // /api/justice/cases/ with a body claiming prepared_packet_approved:true, and relay it to
  // Node test output. Also reused by logPlaywrightApprovePacketDiagnostic (chat-ai/page.tsx),
  // logPlaywrightPersistDiagnostic (persistPreparedPacketApprovalToCase.ts), and
  // logPlaywrightPatchDiagnostic (patchJusticeCaseFromChat.ts) to relay their own events
  // through the same bridge — Playwright's trace console capture has not surfaced any call
  // to the known production producer despite the PATCH provably occurring, so this bypasses
  // trace capture entirely via an exposed binding. Relays only kind, url/event name,
  // invocationId/fetchAttempt (patch/persist kinds only), a timestamp, and the stack — never
  // the request body, `details`, case state, actions, or any user/chat content. Must be wired
  // before any navigation so the init script attaches to the very first document.
  type E2eDiagRelayPayload =
    | { kind: "fetch"; url: string; time: number; stack: string }
    | { kind: "approval"; event: string; time: number; stack: string }
    | { kind: "persist"; event: string; invocationId: number; time: number; stack: string }
    | {
        kind: "patch";
        event: string;
        invocationId: number;
        fetchAttempt: number;
        time: number;
        stack: string;
      };
  await page.exposeBinding(
    "__e2ePatchStackRelay",
    (_source, payload: E2eDiagRelayPayload) => {
      if (payload.kind === "fetch") {
        console.log(
          `[e2e-fetch-diag] PATCH prepared_packet_approved:true url=${payload.url} time=${payload.time}\n${payload.stack}`
        );
      } else if (payload.kind === "approval") {
        console.log(
          `[e2e-approval-diag] ${payload.event} time=${payload.time}\n${payload.stack}`
        );
      } else if (payload.kind === "persist") {
        console.log(
          `[e2e-persist-diag] ${payload.event} invocationId=${payload.invocationId} time=${payload.time}\n${payload.stack}`
        );
      } else {
        console.log(
          `[e2e-patch-diag] ${payload.event} invocationId=${payload.invocationId} fetchAttempt=${payload.fetchAttempt} time=${payload.time}\n${payload.stack}`
        );
      }
    }
  );
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      try {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const body = init?.body;
        if (
          method === "PATCH" &&
          url.includes("/api/justice/cases/") &&
          typeof body === "string" &&
          body.includes('"prepared_packet_approved":true')
        ) {
          const stack = new Error().stack ?? "";
          const time = Date.now();
          void (
            window as unknown as {
              __e2ePatchStackRelay: (p: {
                kind: "fetch";
                url: string;
                time: number;
                stack: string;
              }) => void;
            }
          ).__e2ePatchStackRelay({ kind: "fetch", url, time, stack });
        }
      } catch {
        // Diagnostics must never break the real fetch call.
      }
      return originalFetch(input, init);
    };
  });

  await driveConsumerToSavedCaseForEvidenceUpload(page);
  await uploadEvidenceFileViaChat(page);
  await expectUrlStaysOnChatAi(page);

  const draftReview = page.locator("#chat-ai-inline-submission-draft-review");
  await expect(draftReview).toBeVisible({ timeout: 30_000 });
  const draftBody = draftReview.locator("pre").filter({ hasText: "DRAFT FOR YOUR REVIEW" });
  await expect(draftBody).toBeVisible();
  const showMoreDraft = draftReview.getByRole("button", { name: "Show more" });
  if (await showMoreDraft.isVisible().catch(() => false)) {
    await showMoreDraft.click();
  }
  await expect(draftBody).toContainText(/Surrenderless carries the next owned outreach and filings/i);
  await expect(draftBody).not.toContainText(/file outside Surrenderless/i);
  await expect(draftBody).not.toContainText(/Evidence page/i);
  await expect(draftReview.getByText(/approve your prepared packet so Surrenderless can carry owned/i)).toBeVisible();
  await expect(draftReview.getByRole("button", { name: "Copy draft for your records" })).toBeVisible();
  await expect(draftReview.getByRole("button", { name: "Generate AI-assisted draft" })).toBeVisible();
  await expect(draftReview.getByRole("link", { name: "Open full submission preview" })).toHaveCount(0);
  await expect(draftReview.locator('a[href="/justice/preview"]')).toHaveCount(0);
  await expect(draftReview.locator('a[href="/justice/evidence"]')).toHaveCount(0);

  const chatInput = page.locator("#chat-ai-input");
  const chatTranscript = chatAiTranscript(page);

  const draftReviewedResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/submission-draft-reviewed"),
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  expect((await draftReviewedResponse).ok()).toBeTruthy();
  await expect(
    chatTranscript.getByText(CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Submission draft reviewed: yes")).toBeVisible({ timeout: 30_000 });
  await expectUrlStaysOnChatAi(page);

  const packetApproval = page.locator("#chat-ai-inline-prepared-packet-approval");
  await expect(packetApproval).toBeVisible({ timeout: 30_000 });
  await expect(packetApproval.locator("pre").filter({ hasText: "JUSTICE CASE PACKET" })).toBeVisible();
  const showMorePacket = packetApproval.getByRole("button", { name: "Show more" });
  if (await showMorePacket.isVisible().catch(() => false)) {
    await showMorePacket.click();
  }
  await expect(packetApproval.locator("pre")).toContainText(/acme-refund-denial/i);
  await expect(packetApproval.getByRole("button", { name: "Copy packet" })).toBeVisible();
  await expect(packetApproval.getByRole("link", { name: "Open full packet page" })).toHaveCount(0);
  await expect(packetApproval.locator('a[href="/justice/packet"]')).toHaveCount(0);
  await expectNoOptionalDestinationPrepOrEvidenceHubLinks(page.locator("main"));

  const checklist = page.getByRole("status", { name: "Active case" }).locator("ul").first();
  await expectNoRequiredMainLadderOffChatLinks(checklist);

  await chatInput.fill(CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    chatTranscript.getByText(CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(packetApproval).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Prepared case packet reviewed: yes")).toBeVisible({
    timeout: 30_000,
  });
  await expectUrlStaysOnChatAi(page);
  await expectNoOptionalDestinationPrepOrEvidenceHubLinks(page.locator("main"));
  expect(page.url()).not.toContain("/justice/preview");
  expect(page.url()).not.toContain("/justice/packet");
});
