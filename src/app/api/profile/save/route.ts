// src/app/api/profile/save/route.ts
import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/utils/supabaseClient';
import { rateLimit } from '@/utils/rateLimiter';
import { getUserOr401 } from '@/server/requireUser';

export async function POST(req: Request) {
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
    const payload = await req.json();
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    // whitelist common fields; keep extras if your table allows them
    const { name, email, address, phone, ...rest } = payload;
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid email' }, { status: 400 });
    }

    const updateData = { id: userId, name, email, address, phone, ...rest };

    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(updateData, { onConflict: 'id' })
      .select()
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data });
  } catch (err: any) {
    console.error('profile/save error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
