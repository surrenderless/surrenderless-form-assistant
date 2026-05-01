// src/app/api/fill-form/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { chromium } from "playwright";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import os from "os";
import util from "util";

import { supabase } from "@/utils/supabaseClient";
import { rateLimit } from "@/utils/rateLimiter";
import { getUserOr401 } from "@/server/requireUser";

type Decision = {
  fieldsToFill?: { selector: string; value: string }[];
  nextButton?: { selectorType: "text" | "id" | "name" | "type"; value: string };
  waitForNavigation?: boolean;
};

export async function POST(req: NextRequest) {
  // ---- auth ----
  const userId = getUserOr401(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ---- rate limit (fail-open on Redis issues) ----
  try {
    if (await rateLimit(userId)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
  } catch (e: any) {
    console.warn("rateLimit failed, allowing:", e?.message || e);
  }

  let browser: any;
  let page: any;
  let context: any;

  try {
    // ---- input + env validation ----
    let body;
    try {
      console.log("FILL MAIN TRY START");
      body = await req.json();
    } catch (e) {
      console.error("JSON PARSE ERROR:", e);
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    
    const { url, email, decision } = body as {
      url?: string;
      email?: string;
      decision?: Decision;
    };

    if (!url || !decision) {
      return NextResponse.json({ error: "Missing url or decision" }, { status: 400 });
    }

    const storageConfigured = !!(
      process.env.SUPABASE_BUCKET &&
      process.env.SUPABASE_URL
    );

    console.log("\n✅ Received /api/fill-form request");
    console.log("➡️ URL:", url);
    console.log("📩 Email:", email);
    console.log("🧠 GPT Decision:", JSON.stringify(decision, null, 2));

    // ---- load profile via internal API (forward cookies so auth passes) ----
    let profileData: any = {};
    if (email) {
      try {
        const base = new URL(req.url).origin;
        const cookie = req.headers.get("cookie") ?? "";
        const profileRes = await fetch(`${base}/api/profile/get`, {
          method: "POST", // use the verb your /api/profile/get expects
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({ email }),
        });
        if (profileRes.ok) {
          const profileJson = await profileRes.json();
          if (profileJson?.profile) {
            profileData = profileJson.profile;
            console.log("📂 Loaded profile data");
          }
        } else {
          console.warn("⚠️ /api/profile/get returned", profileRes.status);
        }
      } catch (e: any) {
        console.warn("⚠️ Profile fetch failed:", e?.message);
      }
    }

    // ---- browser/session ----
    const browserlessUrl = process.env.BROWSERLESS_URL;
    console.log("fill-form BROWSERLESS_URL:", browserlessUrl ? "(set)" : "(missing, using local chromium)");
    try {
      if (browserlessUrl) {
        browser = await chromium.connectOverCDP(browserlessUrl);
      } else {
        browser = await chromium.launch({ headless: true });
      }
    } catch (e: any) {
      throw new Error(
        "Failed to start browser: " +
          (browserlessUrl ? "Browserless " : "local chromium ") +
          (e?.message || e)
      );
    }
    const contextOpts =
      process.env.DEPLOY_PASSWORD != null && process.env.DEPLOY_PASSWORD !== ""
        ? { httpCredentials: { username: "admin", password: process.env.DEPLOY_PASSWORD } as const }
        : {};
    context = await browser.newContext(contextOpts);
    page = await context.newPage();

    await page.goto(url, { timeout: 60000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const fieldsToFill = decision.fieldsToFill || [];
    const nextButton = decision.nextButton;

    // ---- fill fields ----
    for (const field of fieldsToFill) {
      try {
        await page.fill(
          `input[name="${field.selector}"], input#${field.selector}, textarea[name="${field.selector}"], textarea#${field.selector}, select[name="${field.selector}"], select#${field.selector}`,
          String(field.value ?? "")
        );
        console.log(`✅ Filled ${field.selector} with "${field.value}"`);
      } catch (err: any) {
        console.warn(`⚠️ Could not fill "${field.selector}":`, err?.message);
      }
    }

    // ---- click next/submit ----
    if (nextButton) {
      let buttonSelector = "";
      const { selectorType, value } = nextButton;
      if (selectorType === "text") buttonSelector = `button:has-text("${value}")`;
      else if (selectorType === "id") buttonSelector = `#${value}`;
      else if (selectorType === "name") buttonSelector = `[name="${value}"]`;
      else if (selectorType === "type") buttonSelector = `button[type="${value}"], input[type="${value}"]`;

      try {
        if (decision.waitForNavigation) {
          await Promise.all([
            page.waitForNavigation({ timeout: 10000 }).catch(() => console.warn("⚠️ Navigation timeout")),
            page.click(buttonSelector),
          ]);
        } else {
          await page.click(buttonSelector);
        }
        console.log(`✅ Clicked button using selector: ${buttonSelector}`);
      } catch (err: any) {
        console.warn("⚠️ Could not click button:", err?.message);
      }
    }

    // ---- collect page context + screenshot ----
    let pageData: any = null;
    let screenshotUrl: string | null = null;

    if (!page?.isClosed?.() && page) {
      try {
        pageData = await page.evaluate(() => {
          const fields = Array.from(document.querySelectorAll("input, textarea, select")).map((field) => {
            // @ts-ignore
            const label = field.labels?.[0]?.innerText || "";
            return {
              tag: field.tagName.toLowerCase(),
              // @ts-ignore
              type: field.type || "",
              name: field.getAttribute("name") || "",
              id: (field as HTMLElement).id || "",
              placeholder: field.getAttribute("placeholder") || "",
              label,
            };
          });

          const buttons = Array.from(document.querySelectorAll("button, input[type='submit']")).map((btn) => ({
            text: btn.textContent?.trim() || "",
            id: (btn as HTMLElement).id || "",
            name: btn.getAttribute("name") || "",
            type: btn.getAttribute("type") || "",
          }));

          return { fields, buttons, url: window.location.href };
        });

        console.log("🧾 Full page context after execution:", JSON.stringify(pageData, null, 2));

        if (storageConfigured) {
          const screenshotName = `${uuidv4()}.png`;
          const screenshotPath = path.join(os.tmpdir(), screenshotName);

          await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 60000 });

          const fileBuffer = fs.readFileSync(screenshotPath);
          const bucket = process.env.SUPABASE_BUCKET!;
          const { data: uploaded, error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(`screenshots/${screenshotName}`, fileBuffer, {
              contentType: "image/png",
              upsert: true,
            });

          if (uploadError) throw new Error("Screenshot upload failed: " + uploadError.message);
          screenshotUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${uploaded?.path}`;
        } else {
          console.log("fill-form: skipping screenshot/upload (Supabase storage env not configured)");
        }
      } catch (err: any) {
        console.warn("⚠️ Screenshot or context collection failed:", err?.message);
      }
    } else {
      console.warn("⚠️ Page was already closed before screenshot.");
    }

    // ---- persist submission ----
    const { error: dbError } = await supabase.from("submissions").insert({
      form_url: url,
      submitted_data: fieldsToFill,
      screenshot_url: screenshotUrl,
      full_page_context: pageData,
      // user_id: userId,            // uncomment if your table has this column
      // profile_snapshot: profileData,
    });
    if (dbError) throw new Error("Database insert failed: " + dbError.message);

    return NextResponse.json({
      status: "success",
      screenshot: screenshotUrl,
      pageData,
      ...(storageConfigured
        ? {}
        : {
            storageSkipped: true,
            storageReason: "Missing Supabase storage env vars",
          }),
    });
  } catch (err: any) {
    console.error("❌ Error in /api/fill-form:\n", util.inspect(err, { depth: 5 }));
    return NextResponse.json({ error: err?.message || "Unknown error occurred" }, { status: 500 });
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {
      console.warn("⚠️ Failed to close browser:", (e as any)?.message || e);
    }
  }
}
