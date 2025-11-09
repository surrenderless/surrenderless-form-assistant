// src/app/api/task-logs/route.ts
import { getAuth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/utils/supabaseClient';
import { NextResponse } from 'next/server';
import { rateLimit } from '@/utils/rateLimiter'; // ⬅️ added

export async function GET(request: Request) {
  try {
    const { userId } = getAuth(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // ⬅️ rate limit (10/min). Fail-open if Redis issue.
    try {
      if (await rateLimit(userId)) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
      }
    } catch (e: any) {
      console.warn('rateLimit failed, allowing:', e?.message);
    }

    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get('limit') ?? '10');
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 10;

    const { data: logs, error } = await supabaseAdmin
      .from('task_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }) // use 'id' if no created_at
      .limit(limit);

    if (error) throw new Error(error.message);
    return NextResponse.json({ logs: logs ?? [] });
  } catch (error: any) {
    console.error('❌ /api/task-logs error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to load task logs' }, { status: 500 });
  }
}
