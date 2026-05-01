// src/app/api/analyze-form/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { chromium, type Browser } from "playwright";
import { rateLimit } from "@/utils/rateLimiter";
import { getUserOr401 } from "@/server/requireUser";

function contextOptions() {
  const pw = process.env.DEPLOY_PASSWORD;
  if (!pw) return {};
  return {
    httpCredentials: { username: "admin", password: pw } as const,
  };
}

function sanitizeDetail(message: unknown): string {
  const s = typeof message === "string" ? message : String(message ?? "unknown");
  return s.replace(/[\r\n]+/g, " ").slice(0, 400);
}

export async function POST(req: NextRequest) {
  let browser: Browser | null = null;
  try {
    const userId = getUserOr401(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
      if (await rateLimit(userId)) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
      }
    } catch (e: any) {
      console.warn("rateLimit failed, allowing:", e?.message);
    }

    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: 'Missing or invalid "url"' }, { status: 400 });
    }

    const browserlessUrl = process.env.BROWSERLESS_URL;
    console.log("analyze-form BROWSERLESS_URL:", browserlessUrl ? "(set)" : "(missing, using local chromium)");

    if (browserlessUrl) {
      browser = await chromium.connectOverCDP(browserlessUrl);
    } else {
      browser = await chromium.launch({ headless: true });
    }

    const context = await browser.newContext(contextOptions());
    const page = await context.newPage();

    await page.goto(url, { timeout: 60000 });

    const formFields = await page.evaluate(() => {
      const fields = Array.from(document.querySelectorAll("input, textarea, select"));
      return fields.map((field: any) => {
        const label = (field.labels && field.labels[0]?.innerText) || "";
        return {
          tag: field.tagName.toLowerCase(),
          type: (field.type as string) || "",
          name: field.getAttribute("name") || "",
          id: field.id || "",
          placeholder: field.getAttribute("placeholder") || "",
          label,
        };
      });
    });

    return NextResponse.json({ fields: formFields });
  } catch (err: any) {
    console.error("analyze-form error:", err);
    const detail = sanitizeDetail(err?.message ?? err);
    return NextResponse.json(
      { error: "analyze-form failed", detail },
      { status: 500 }
    );
  } finally {
    try {
      if (browser) await browser.close();
    } catch (closeErr: any) {
      console.error("analyze-form browser close error:", closeErr);
    }
  }
}
