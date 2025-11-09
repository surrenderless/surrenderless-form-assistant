import { NextResponse } from "next/server";
import { chromium } from "playwright";

export async function GET() {
  try {
    const url = process.env.BROWSERLESS_URL;
    if (!url) return NextResponse.json({ ok:false, error:"BROWSERLESS_URL missing" }, { status:500 });

    const browser = await chromium.connectOverCDP(url);
    await browser.close();
    return NextResponse.json({ ok:true, message:"Connected to Browserless" });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message || e) }, { status:500 });
  }
}
