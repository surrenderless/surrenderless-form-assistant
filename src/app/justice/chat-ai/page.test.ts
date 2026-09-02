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
