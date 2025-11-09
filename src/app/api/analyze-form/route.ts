// src/app/api/analyze-form/route.ts
import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { rateLimit } from '@/utils/rateLimiter';
import { getUserOr401 } from '@/server/requireUser';

export async function POST(req: Request) {
  try {
    const userId = getUserOr401();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // rate limit (fail-open on Redis issues)
    try {
      if (await rateLimit(userId)) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
      }
    } catch (e: any) {
      console.warn('rateLimit failed, allowing:', e?.message);
    }

    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "url"' }, { status: 400 });
    }

    console.log('BROWSERLESS_URL:', process.env.BROWSERLESS_URL);
    if (!process.env.BROWSERLESS_URL) {
      return NextResponse.json({ error: 'BROWSERLESS_URL not configured' }, { status: 500 });
    }

    const browser = await chromium.connectOverCDP(process.env.BROWSERLESS_URL);
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(url, { timeout: 60000 });

      const formFields = await page.evaluate(() => {
        const fields = Array.from(document.querySelectorAll('input, textarea, select'));
        return fields.map((field: any) => {
          const label = (field.labels && field.labels[0]?.innerText) || '';
          return {
            tag: field.tagName.toLowerCase(),
            type: (field.type as string) || '',
            name: field.getAttribute('name') || '',
            id: field.id || '',
            placeholder: field.getAttribute('placeholder') || '',
            label,
          };
        });
      });

      return NextResponse.json({ fields: formFields });
    } finally {
      await browser.close();
    }
  } catch (err: any) {
    console.error('analyze-form error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
