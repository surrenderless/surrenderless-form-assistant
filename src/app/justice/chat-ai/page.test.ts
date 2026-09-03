import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * page.tsx is a large client component (hooks, Clerk, router, browser APIs) with no jsdom/RTL
 * setup in this repo — vitest.config.ts runs in a "node" environment, and this page's behavior is
 * otherwise verified via Playwright e2e, not component-level unit tests. These are structural
 * regression checks on the source text for a first UX polish batch, guarding against each fix
 * silently regressing:
 *  - the message transcript no longer sits in its own fixed-height, internally-scrolling box
 *    nested inside the page's own scroll (was `max-h-[min(420px,50vh)] ... overflow-y-auto`)
 *  - the Active Case checklist visually differentiates a completed row from a pending one, not
 *    just via the word "yes" vs "not yet"
 *  - the primary chat-send error is announced to assistive tech via role="alert"
 *  - the main container is widened from max-w-lg to max-w-2xl (desktop-only effect: both are
 *    wider than any mobile viewport, so mobile layout/padding is unaffected either way)
 */

const pageSource = fs.readFileSync(
  path.join(process.cwd(), "src", "app", "justice", "chat-ai", "page.tsx"),
  "utf8"
);

describe("chat-ai page UX polish batch", () => {
  it("does not nest the message transcript in its own fixed-height scroll box", () => {
    expect(pageSource).not.toMatch(/overflow-y-auto/);
    expect(pageSource).not.toMatch(/max-h-\[min\(420px/);
  });

  it("scrolls the transcript into view via scrollIntoView now that it is not its own scroll container", () => {
    expect(pageSource).toMatch(/scrollRef\.current\?\.scrollIntoView\(/);
  });

  it("visually differentiates completed vs pending Active Case checklist rows", () => {
    expect(pageSource).toMatch(/function ActiveCaseChecklistStatus/);
    const usages = pageSource.match(/<ActiveCaseChecklistStatus done=\{/g) ?? [];
    expect(usages.length).toBe(4);
    expect(pageSource).toMatch(/Basic case info: <ActiveCaseChecklistStatus done=\{activeCaseBasicsReady\}/);
    expect(pageSource).toMatch(/Evidence: <ActiveCaseChecklistStatus done=\{activeCaseEvidenceReady\}/);
    expect(pageSource).toMatch(
      /Submission draft reviewed: <ActiveCaseChecklistStatus done=\{activeCaseDraftReviewed\}/
    );
    expect(pageSource).toMatch(
      /Prepared case packet reviewed: <ActiveCaseChecklistStatus done=\{preparedPacketApproved\}/
    );
  });

  it("keeps the literal word \"yes\" as a leading substring of the done state, not preceded by the checkmark", () => {
    // Existing e2e specs assert on substrings like getByText("Evidence: yes") without exact:
    // true; the decorative checkmark must render AFTER the word "yes", never before it, or every
    // one of those (non-exact, substring) locators stops matching.
    const doneBranchMatch = pageSource.match(
      /function ActiveCaseChecklistStatus[\s\S]*?return done \? \(([\s\S]*?)\) : \(/
    );
    expect(doneBranchMatch).not.toBeNull();
    const doneBranch = doneBranchMatch![1]!;
    expect(doneBranch.indexOf("yes")).toBeGreaterThanOrEqual(0);
    expect(doneBranch.indexOf("yes")).toBeLessThan(doneBranch.indexOf('aria-hidden="true">✓'));
  });

  it("widens the main container to max-w-2xl and preserves the existing mobile-safe padding", () => {
    const mainMatch = pageSource.match(
      /<main className="(mx-auto flex min-h-\[calc\(100vh-4rem\)\][^"]*)">/
    );
    expect(mainMatch).not.toBeNull();
    const mainClassName = mainMatch![1]!;
    expect(mainClassName).toMatch(/\bmax-w-2xl\b/);
    expect(mainClassName).not.toMatch(/\bmax-w-lg\b/);
    expect(mainClassName).toMatch(/\bpx-4\b/);
    expect(mainClassName).toMatch(/\bsm:px-6\b/);
    expect(mainClassName).toMatch(/\bpy-8\b/);
    expect(mainClassName).toMatch(/\bpb-16\b/);
  });

  it("announces the primary chat-send error to assistive tech", () => {
    const errorParagraphMatch = pageSource.match(
      /\{apiError \? \(([\s\S]{0,200}?)\) : null\}/
    );
    expect(errorParagraphMatch).not.toBeNull();
    expect(errorParagraphMatch?.[1]).toMatch(/role="alert"/);
  });
});

/**
 * Second UX polish batch, addressing findings from the second-pass audit:
 *  - "Generate/Regenerate AI-assisted draft" and "Copy packet" are optional utility actions that
 *    previously shared the exact same solid-filled button style as the actual required next
 *    action in their card ("Mark draft reviewed" / "Approve prepared packet"), leaving no visual
 *    signal for which button progresses the case. Only the primary action should be solid-filled.
 *  - the packet-approval card no longer restates the draft-review card's "doesn't send anything
 *    yet" reassurance in different words.
 *
 * A sticky-positioned compose input was tried and reverted: on mobile visual QA it overlapped
 * chat bubbles and left a large blank gap before the Recap section. The compose input stays in
 * normal document flow; the test below guards against sticky positioning being reintroduced here.
 */
describe("chat-ai page UX polish batch 2", () => {
  function extractFunctionBody(functionName: string): string {
    // Top-level functions in this file all start at column 0; bound extraction at the next one
    // rather than counting braces, since a naive brace-match stops at the first nested `}` line.
    const match = pageSource.match(
      new RegExp(`\\nfunction ${functionName}\\([\\s\\S]*?(?=\\nfunction |\\nexport default function )`)
    );
    expect(match, `could not locate function ${functionName}`).not.toBeNull();
    return match![0]!;
  }

  it("styles the optional 'Generate/Regenerate AI-assisted draft' button as secondary, not the same as the required 'Mark draft reviewed' action", () => {
    const draftBlock = extractFunctionBody("ChatInlineSubmissionDraftReviewBlock");
    const generateButtonMatch = draftBlock.match(
      /onClick=\{\(\) => void onGenerateAiDraft\(\)\}[\s\S]{0,20}className="([^"]*)"/
    );
    expect(generateButtonMatch).not.toBeNull();
    expect(generateButtonMatch![1]).not.toMatch(/\bbg-blue-700\b/);
    expect(generateButtonMatch![1]).toMatch(/\bbg-white\b/);

    const markReviewedButtonMatch = draftBlock.match(
      /onClick=\{\(\) => void onSubmit\(\)\}[\s\S]{0,20}className="([^"]*)"/
    );
    expect(markReviewedButtonMatch).not.toBeNull();
    expect(markReviewedButtonMatch![1]).toMatch(/\bbg-blue-700\b/);
  });

  it("styles the optional 'Copy packet' button as secondary, not the same as the required 'Approve prepared packet' action", () => {
    const packetBlock = extractFunctionBody("ChatInlinePreparedPacketApprovalBlock");
    const copyButtonMatch = packetBlock.match(
      /onClick=\{\(\) => onCopyPacket\(\)\}[\s\S]{0,20}className="([^"]*)"/
    );
    expect(copyButtonMatch).not.toBeNull();
    expect(copyButtonMatch![1]).not.toMatch(/\bbg-emerald-700\b/);
    expect(copyButtonMatch![1]).toMatch(/\bbg-white\b/);

    const approveButtonMatch = packetBlock.match(
      /onClick=\{\(\) => void onSubmit\(\)\}[\s\S]{0,20}className="([^"]*)"/
    );
    expect(approveButtonMatch).not.toBeNull();
    expect(approveButtonMatch![1]).toMatch(/\bbg-emerald-700\b/);
  });

  it("no longer restates the draft-review card's reassurance copy in the packet-approval card", () => {
    const packetBlock = extractFunctionBody("ChatInlinePreparedPacketApprovalBlock");
    expect(packetBlock).not.toMatch(/does not submit, file, or contact anyone/);
  });

  it("keeps the compose input in normal document flow — not sticky/bottom-0 (reverted: overlapped chat bubbles and left a blank gap before Recap on mobile)", () => {
    const composeContainerMatch = pageSource.match(
      /className="(mt-4 border-t border-neutral-100[^"]*)"/
    );
    expect(composeContainerMatch).not.toBeNull();
    const composeClassName = composeContainerMatch![1]!;
    expect(composeClassName).not.toMatch(/\bsticky\b/);
    expect(composeClassName).not.toMatch(/\bbottom-0\b/);
  });
});
