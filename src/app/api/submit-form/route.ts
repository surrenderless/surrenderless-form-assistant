// src/app/api/submit-form/route.ts
import { NextResponse } from "next/server";
import { rateLimit } from "@/utils/rateLimiter";
import { getUserOr401 } from "@/server/requireUser";

export async function POST(req: Request) {
  // auth
  const userId = getUserOr401();
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
    if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

    const base = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") ?? "";

    // 1) analyze
    const analyzeRes = await fetch(`${base}/api/analyze-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ url }),
    });
    if (!analyzeRes.ok) throw new Error("analyze-form failed");
    const { fields } = await analyzeRes.json();

    // 2) match
    const matchRes = await fetch(`${base}/api/match-fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ fields, userData }),
    });
    if (!matchRes.ok) throw new Error("match-fields failed");
    const { instructions } = await matchRes.json();

    // 3) fill
    const fillRes = await fetch(`${base}/api/fill-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
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
    if (!fillRes.ok) throw new Error("fill-form failed");

    const result = await fillRes.json();
    return NextResponse.json({ result: "Success", fillResult: result });
  } catch (err: any) {
    console.error("Submit-form error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
