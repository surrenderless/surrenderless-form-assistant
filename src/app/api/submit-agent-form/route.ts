// src/app/api/submit-agent-form/route.ts
import { NextResponse } from 'next/server';
import { runCrewBridge } from '@/server/CrewBridge';
import { rateLimit } from '@/utils/rateLimiter';
import { getUserOr401 } from '@/server/requireUser';

export async function POST(req: Request) {
  // auth
  const userId = getUserOr401();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // rate limit (10/min). Fail-open on Redis error.
  try {
    if (await rateLimit(userId)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }
  } catch (e: any) {
    console.warn('rateLimit failed, allowing:', e?.message);
  }

  try {
    const { url, userData } = await req.json();
    if (!url || !userData) {
      return NextResponse.json(
        { error: 'Missing required fields: url and userData' },
        { status: 400 }
      );
    }

    const result = await runCrewBridge({ url, userData });
    return NextResponse.json({ result });
  } catch (err: any) {
    console.error('❌ Agent run error:', err?.stack || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
