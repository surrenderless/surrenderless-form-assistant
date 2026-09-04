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
    // Evidence uses its own EvidenceChecklistStatus component (see the next-action precedence
    // suite below) — the other three required-info rows use ActiveCaseChecklistStatus.
    const usages = pageSource.match(/<ActiveCaseChecklistStatus done=\{/g) ?? [];
    expect(usages.length).toBe(3);
    expect(pageSource).toMatch(/Basic case info: <ActiveCaseChecklistStatus done=\{activeCaseBasicsReady\}/);
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

/**
 * Corrected state-precedence redesign. Priority order for "the one primary action right now":
 *   1. draft review (showInlineSubmissionDraftReview)
 *   2. packet approval (showInlinePreparedPacketApproval)
 *   3. required tracking input (trackingNeedsRecipient — a recipient email a lane can't send
 *      without)
 *   4. passive tracking status (approvedNextAction exists, no input required)
 *   5. ordinary chat/intake (none of the above — ordinary Send-driven conversation)
 *
 * Evidence is explicitly excluded from this precedence — it is optional/recommended and must
 * never be the reason chat expands, collapses, or blocks any of the above.
 */
describe("chat-ai page next-action precedence redesign", () => {
  function extractFunctionBody(functionName: string): string {
    const match = pageSource.match(
      new RegExp(`\\nfunction ${functionName}\\([\\s\\S]*?(?=\\nfunction |\\nexport default function )`)
    );
    expect(match, `could not locate function ${functionName}`).not.toBeNull();
    return match![0]!;
  }

  it("derives trackingNeedsRecipient only from an existing approvedNextAction plus exactly one of the two recipient-needed flags", () => {
    const match = pageSource.match(
      /const trackingNeedsRecipient = Boolean\(approvedNextAction\) && trackingRecipientEmailKind !== null;/
    );
    expect(match).not.toBeNull();
    const kindMatch = pageSource.match(
      /const trackingRecipientEmailKind: "demand_letter" \| "merchant_contact" \| null =\s*\n\s*showDemandLetterNeedsRecipientNotice\s*\n\s*\? "demand_letter"\s*\n\s*: showMerchantContactNeedsRecipientNotice\s*\n\s*\? "merchant_contact"\s*\n\s*: null;/
    );
    expect(kindMatch).not.toBeNull();
  });

  it("derives dedicatedActionActive from exactly draft review, packet approval, or an existing approvedNextAction — nothing else, evidence never included", () => {
    const match = pageSource.match(
      /const dedicatedActionActive =\s*\n\s*showInlineSubmissionDraftReview \|\| showInlinePreparedPacketApproval \|\| Boolean\(approvedNextAction\);/
    );
    expect(match).not.toBeNull();
  });

  it("impossible/overlapping combinations: draft review and packet approval can never both be the active gate, by construction of showInlinePreparedPacketApproval", () => {
    // showInlinePreparedPacketApproval already requires activeCaseDraftReviewed (draft review
    // done), and showInlineSubmissionDraftReview requires !activeCaseDraftReviewed — mutually
    // exclusive by the existing gates this redesign builds on top of, not new logic.
    const packetGate = pageSource.match(
      /const showInlinePreparedPacketApproval =\s*([\s\S]*?);\r?\n/
    );
    expect(packetGate).not.toBeNull();
    expect(packetGate![1]).toMatch(/activeCaseDraftReviewed/);
    expect(packetGate![1]).toMatch(/!preparedPacketApproved/);
    const draftGate = pageSource.match(/const showInlineSubmissionDraftReview =\s*([\s\S]*?);\r?\n/);
    expect(draftGate).not.toBeNull();
    expect(draftGate![1]).toMatch(/!activeCaseDraftReviewed/);
  });

  it("renders the recipient-email form exactly once (in the compact tracking summary), never in the detailed tracker", () => {
    const usages = pageSource.match(/<ChatTrackingRecipientEmailForm/g) ?? [];
    expect(usages.length).toBe(1);
    // The detailed tracker's two former recipient-form branches must now be status-only text
    // pointing back up to the one real form, not a second copy of the label/input/buttons.
    const detailedTrackerBody = pageSource.match(
      /<details\s+className="group mt-2"[\s\S]*?<\/details>/
    );
    expect(detailedTrackerBody).not.toBeNull();
    expect(detailedTrackerBody![0]).not.toMatch(/<input/);
    expect(detailedTrackerBody![0]).toMatch(/Add it in the required-action box above to continue\./);
    // Regression: the detailed tracker's status-only text must never repeat the exact intro
    // sentence used inside ChatTrackingRecipientEmailForm's `copy.intro` — CI caught this as a
    // strict-mode violation (getByText resolved to 2 elements) because both the real form and
    // this status text used "We need the company's email to send your first contact."
    expect(detailedTrackerBody![0]).not.toMatch(/We need the company/);
  });

  it("defines the shared recipient-email form component with both lane copy variants and no duplicated markup between them", () => {
    const formBody = extractFunctionBody("ChatTrackingRecipientEmailForm");
    expect(formBody).toMatch(/"Save and send demand letter"/);
    expect(formBody).toMatch(/"Save and send first contact"/);
    // Exactly one <input> and one submit <button> definition — proof the two lanes share markup
    // via the `copy` object rather than each rendering their own copy of the form.
    expect((formBody.match(/<input/g) ?? []).length).toBe(1);
    expect((formBody.match(/type="submit"|Sending…/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("labels evidence as optional and uses Added/None added, never the blocking-sounding 'not yet'", () => {
    expect(pageSource).toMatch(/"Evidence \(optional\): loading\.\.\."/);
    expect(pageSource).toMatch(
      /Evidence \(optional\): <EvidenceChecklistStatus added=\{activeCaseEvidenceReady\}/
    );
    const evidenceComponent = extractFunctionBody("EvidenceChecklistStatus");
    expect(evidenceComponent).toMatch(/>None added</);
    expect(evidenceComponent).not.toMatch(/not yet/);
    // Same lesson as the ActiveCaseChecklistStatus fix: the checkmark must render AFTER the word
    // "Added", or non-exact e2e substring locators like getByText("Evidence (optional): Added")
    // stop matching.
    const addedBranch = evidenceComponent.match(/return added \? \(([\s\S]*?)\) : \(/);
    expect(addedBranch).not.toBeNull();
    expect(addedBranch![1]!.indexOf("Added")).toBeGreaterThanOrEqual(0);
    expect(addedBranch![1]!.indexOf("Added")).toBeLessThan(addedBranch![1]!.indexOf('aria-hidden="true">✓'));
  });

  it("never makes evidence a gate: it appears nowhere in the dedicatedActionActive, showInline*, or trackingNeedsRecipient formulas", () => {
    for (const formulaName of [
      "dedicatedActionActive",
      "showInlineSubmissionDraftReview",
      "showInlinePreparedPacketApproval",
      "trackingNeedsRecipient",
    ]) {
      const match = pageSource.match(new RegExp(`const ${formulaName} =\\s*([\\s\\S]*?);\\r?\\n`));
      expect(match, `could not locate formula ${formulaName}`).not.toBeNull();
      expect(match![1]).not.toMatch(/evidence/i);
    }
  });

  it("wraps only the composer — not the transcript — in an accessible native <details> disclosure with a summary, not a custom widget", () => {
    const detailsMatch = pageSource.match(
      /<details\s+className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700\/80"\s*\n\s*open=\{chatDisclosureOpen\}[\s\S]*?<summary[\s\S]*?<\/summary>/
    );
    expect(detailsMatch).not.toBeNull();
    expect(detailsMatch![0]).toMatch(/onToggle=\{\(e\) => setChatDisclosureUserOverride\(e\.currentTarget\.open\)\}/);
    expect(detailsMatch![0]).toMatch(/cursor-pointer/);
    expect(detailsMatch![0]).toMatch(/Need to change something\? Continue in chat/);
  });

  it("computes chatDisclosureOpen as expanded-by-default before a dedicated action, collapsed-by-default once one exists, with an explicit user override always winning", () => {
    const match = pageSource.match(
      /const chatDisclosureOpen = chatDisclosureUserOverride \?\? !dedicatedActionActive;/
    );
    expect(match).not.toBeNull();
  });

  it("keeps the transcript outside (before) the composer's <details>, never nested inside it, so it's never hidden when the composer collapses", () => {
    // Both anchors are single-line literals, so CRLF vs LF is irrelevant here.
    const transcriptIndex = pageSource.indexOf('id="chat-ai-transcript"');
    const composerDetailsIndex = pageSource.indexOf("open={chatDisclosureOpen}");
    expect(transcriptIndex).toBeGreaterThan(0);
    expect(composerDetailsIndex).toBeGreaterThan(0);
    expect(transcriptIndex).toBeLessThan(composerDetailsIndex);
  });

  it("keeps Recap outside (a sibling after) the collapsible composer disclosure, so it never hides when the composer collapses", () => {
    const afterDetails = pageSource.split(
      '<summary className="cursor-pointer text-sm font-semibold text-neutral-800 dark:text-neutral-100">'
    )[1];
    expect(afterDetails).toBeDefined();
    const closesBeforeRecap = afterDetails!.indexOf("</details>");
    const recapIndex = afterDetails!.indexOf(">Recap<");
    expect(closesBeforeRecap).toBeGreaterThan(0);
    expect(recapIndex).toBeGreaterThan(closesBeforeRecap);
  });

  it("preserves the transcript and unsaved composer input across open/close by using native <details> for the composer only (children stay mounted, not conditionally rendered)", () => {
    // The transcript (messages.map) is never inside the composer's <details> — it can't be
    // hidden by the composer collapsing. The textarea/Send/Save-changes controls ARE inside it,
    // and must not be behind a separate {open ? ... : null} conditional that would unmount them.
    const composerDetailsMatch = pageSource.match(
      /<details\s+className="mt-4 border-t border-neutral-100[^"]*"\s*\n\s*open=\{chatDisclosureOpen\}[\s\S]*?<\/details>/
    );
    expect(composerDetailsMatch).not.toBeNull();
    expect(composerDetailsMatch![0]).not.toMatch(/\{messages\.map\(/);
    expect(composerDetailsMatch![0]).toMatch(/id="chat-ai-input"/);
    expect(composerDetailsMatch![0]).not.toMatch(/\{chatDisclosureOpen \? /);

    const transcriptDivMatch = pageSource.match(
      /<div ref=\{scrollRef\} id="chat-ai-transcript" className="[^"]*">([\s\S]*?)<\/div>\s*\n\s*<details/
    );
    expect(transcriptDivMatch).not.toBeNull();
    expect(transcriptDivMatch![1]).toMatch(/\{messages\.map\(/);
  });

  it("Send is the only filled/primary control before a dedicated action while basics are incomplete; Save and continue takes over once ready, and both this is never in a dedicated-action state at the same time as the standalone bottom Save button existing", () => {
    const sendButtonMatch = pageSource.match(
      /onClick=\{\(\) => void handleSend\(\)\}[\s\S]{0,40}className=\{([\s\S]*?)\}\s*\n\s*>/
    );
    expect(sendButtonMatch).not.toBeNull();
    expect(sendButtonMatch![1]).toMatch(/!dedicatedActionActive && basicsMissing\.length > 0/);
    expect(sendButtonMatch![1]).toMatch(/bg-blue-600/);

    const bottomSaveMatch = pageSource.match(
      /\{!dedicatedActionActive \? \(\s*\n\s*<button[\s\S]{0,1200}?"Save and continue in chat"/
    );
    expect(bottomSaveMatch).not.toBeNull();
    expect(bottomSaveMatch![0]).toMatch(/basicsMissing\.length === 0/);
  });

  it("hides the standalone bottom Save button once any dedicated review/approval/tracking state exists", () => {
    const match = pageSource.match(
      /\{!dedicatedActionActive \? \(\s*\n\s*<button\s*\n\s*type="button"\s*\n\s*disabled=\{submitting \|\| loading \|\| basicsMissing\.length > 0\}\s*\n\s*onClick=\{\(\) => void handleContinueToPreview\(\)\}/
    );
    expect(match).not.toBeNull();
  });

  it("exposes a save-changes action inside the expanded chat disclosure when edits are pending, instead of only via the (now-hidden) bottom button", () => {
    const chatSectionMatch = pageSource.match(
      /<details\s+className="mt-4 border-t border-neutral-100[^"]*"\s*\n\s*open=\{chatDisclosureOpen\}[\s\S]*?<\/details>/
    );
    expect(chatSectionMatch).not.toBeNull();
    expect(chatSectionMatch![0]).toMatch(/\{dedicatedActionActive && showSessionChangesPanel \? \(/);
    expect(chatSectionMatch![0]).toMatch(/"Save changes"/);
  });

  it("keeps the detailed tracking panel below the compact summary and collapsed by default", () => {
    const match = pageSource.match(
      /<details\s*\n\s*className="group mt-2"\s*\n\s*open=\{detailedTrackingOpen\}\s*\n\s*onToggle=\{\(e\) => setDetailedTrackingOpen\(e\.currentTarget\.open\)\}\s*\n\s*>/
    );
    expect(match).not.toBeNull();
    expect(pageSource).toMatch(/const \[detailedTrackingOpen, setDetailedTrackingOpen\] = useState\(false\);/);
  });

  it("resets the chat disclosure's manual override whenever the specific dedicated action changes, so auto-collapse works for every new action, not just the session's first one", () => {
    // Regression: chatDisclosureUserOverride previously never reset, so one manual expand during
    // any dedicated action permanently suppressed auto-collapse for every later, unrelated one
    // (draft review -> packet approval -> tracking).
    expect(pageSource).toMatch(
      /const dedicatedActionKey = showInlineSubmissionDraftReview\s*\n\s*\? "draft_review"\s*\n\s*: showInlinePreparedPacketApproval\s*\n\s*\? "packet_approval"\s*\n\s*: approvedNextAction\s*\n\s*\? `tracking:\$\{approvedNextAction\.href \?\? ""\}`\s*\n\s*: "none";/
    );
    const effectMatch = pageSource.match(
      /useEffect\(\(\) => \{\s*\n([\s\S]*?)\}, \[dedicatedActionKey\]\);/
    );
    expect(effectMatch).not.toBeNull();
    expect(effectMatch![1]).toMatch(/setChatDisclosureUserOverride\(null\);/);
  });
});
