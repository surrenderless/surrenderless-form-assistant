// src/app/api/submit-form/route.ts
import { NextResponse, type NextRequest } from "next/server";
import {
  evaluateAssistedSubmissionUrlPolicy,
  isAllowedExternalAssistedSubmissionUrl,
} from "@/lib/justice/assistedSubmissionExternalUrl";
import { runRealBbbBoundedSubmit } from "@/lib/justice/runRealBbbBoundedSubmit";
import {
  buildPlaywrightMockRealBbbBoundedSubmitFillResult,
  isPlaywrightMockAssistedSubmitPipelineEnabled,
} from "@/lib/testing/playwrightMockAssistedSubmitPipeline";
import { isPlaywrightMockRealBbbBoundedSubmitLoopEnabled } from "@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

export async function POST(req: NextRequest) {
  // auth
  const userId = getUserOr401(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // rate limit (10/min). Fail-open on Redis error.
  try {
    if (await rateLimit(userId)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
  } catch (e: any) {
    console.warn("rateLimit failed, allowing:", e?.message);
  }

  try {
    const { url, userData } = await req.json();
    const base = new URL(req.url).origin;
    const policy = evaluateAssistedSubmissionUrlPolicy(url, base);
    if (!policy.allowed) {
      return NextResponse.json(
        { error: policy.error },
        { status: policy.error === "Missing url" ? 400 : 403 }
      );
    }

    const cookie = req.headers.get("cookie");
    const deployPassword = process.env.DEPLOY_PASSWORD;
    const basicAuth =
      deployPassword
        ? `Basic ${Buffer.from(`admin:${deployPassword}`).toString("base64")}`
        : undefined;
    const forwardedHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cookie) forwardedHeaders.cookie = cookie;
    if (basicAuth) forwardedHeaders.authorization = basicAuth;

    if (isAllowedExternalAssistedSubmissionUrl(url)) {
      if (
        isPlaywrightMockAssistedSubmitPipelineEnabled() &&
        !isPlaywrightMockRealBbbBoundedSubmitLoopEnabled()
      ) {
        return NextResponse.json({
          result: "Success",
          fillResult: buildPlaywrightMockRealBbbBoundedSubmitFillResult(url),
        });
      }

      const bounded = await runRealBbbBoundedSubmit({
        url,
        userData: userData ?? {},
        base,
        forwardedHeaders,
      });
      if (!bounded.ok) {
        return NextResponse.json(
          {
            error: bounded.error,
            stopReason: bounded.stopReason,
            stepsExecuted: bounded.stepsExecuted,
            fillResult: bounded.fillResult,
            technicalDetails: bounded.technicalDetails,
          },
          { status: 422 }
        );
      }
      return NextResponse.json({ result: "Success", fillResult: bounded.fillResult });
    }

    // 1) analyze
    const analyzeRes = await fetch(`${base}/api/analyze-form`, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify({ url }),
    });
    if (!analyzeRes.ok) {
      const raw = await analyzeRes.text();
      let detail = raw.slice(0, 400);
      try {
        const j = JSON.parse(raw) as { error?: string; detail?: string };
        detail = [j.error, j.detail].filter(Boolean).join(" — ") || detail;
      } catch {
        /* use raw slice */
      }
      console.error("submit-form analyze-form:", analyzeRes.status, detail);
      throw new Error(`analyze-form failed (${analyzeRes.status}): ${detail}`);
    }
    const { fields } = await analyzeRes.json();

    // 2) match
    const matchRes = await fetch(`${base}/api/match-fields`, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify({ fields, userData }),
    });
    if (!matchRes.ok) throw new Error("match-fields failed");
    const { instructions } = await matchRes.json();

    // 3) fill
    const fillRes = await fetch(`${base}/api/fill-form`, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify({
        url,
        email: userData?.email || "",
        decision: {
          fieldsToFill: instructions,
          nextButton: { selectorType: "type", value: "submit" },
          waitForNavigation: false,
        },
      }),
    });
    const fillText = await fillRes.text();
    if (!fillRes.ok) {
      console.error("submit-form fill-form failed:", fillRes.status, fillText);
      let detail = fillText;
      try {
        const parsed = JSON.parse(fillText) as { error?: string; detail?: string };
        detail = parsed.error || parsed.detail || fillText;
      } catch {
        /* use fillText */
      }
      throw new Error(`fill-form failed (${fillRes.status}): ${detail}`);
    }

    const result = JSON.parse(fillText);
    return NextResponse.json({ result: "Success", fillResult: result });
  } catch (err: any) {
    console.error("Submit-form error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
