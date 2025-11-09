// src/app/api/match-fields/route.ts
import { NextResponse } from 'next/server';
import { rateLimit } from '@/utils/rateLimiter';
import { getUserOr401 } from '@/server/requireUser';

export async function POST(req: Request) {
  try {
    // auth (helper; same behavior as before)
    const userId = getUserOr401();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // rate limit (10/min). Fail-open if Redis issue.
    try {
      if (await rateLimit(userId)) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
      }
    } catch (e: any) {
      console.warn('rateLimit failed, allowing:', e?.message);
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
    }

    const body = await req.json();
    const { fields, userData } = body || {};
    if (!Array.isArray(fields)) {
      return NextResponse.json({ error: 'Invalid "fields"' }, { status: 400 });
    }

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4-1106-preview',
        messages: [
          {
            role: 'system',
            content:
              "You're an expert form-filling assistant. Return only the JSON array with matches. No explanation, no extra text.",
          },
          {
            role: 'user',
            content: `Here are form fields:\n${JSON.stringify(fields)}\n\nHere is the user data:\n${JSON.stringify(
              userData ?? {}
            )}\n\nReturn a list of matches like: [{ "selector": "name or id", "value": "user value" }]`,
          },
        ],
        temperature: 0,
      }),
    });

    if (!gptRes.ok) {
      const errorText = await gptRes.text();
      console.error('OpenAI API error:', errorText);
      return NextResponse.json({ error: 'GPT API call failed', details: errorText }, { status: 500 });
    }

    const gptJson = await gptRes.json();
    let rawContent: string = gptJson?.choices?.[0]?.message?.content || '[]';

    // Extract fenced JSON if present
    const fenced = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) rawContent = fenced[1];

    let matches: any[] = [];
    try {
      const parsed = JSON.parse(rawContent);
      matches = Array.isArray(parsed) ? parsed : [];
    } catch (parseErr) {
      console.error('Failed to parse GPT content:', rawContent);
      return NextResponse.json({ error: 'GPT returned invalid JSON', raw: rawContent }, { status: 500 });
    }

    return NextResponse.json({ instructions: matches });
  } catch (err: any) {
    console.error('match-fields error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
