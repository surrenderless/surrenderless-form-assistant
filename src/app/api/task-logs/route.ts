// src/app/api/task-logs/route.ts
import { getAuth } from '@clerk/nextjs/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit } from '@/utils/rateLimiter'; // ⬅️ added

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function supabaseUnavailableResponse() {
  return NextResponse.json(
    { error: 'Supabase is not configured on this server.' },
    { status: 503 }
  );
}

export async function GET(request: NextRequest) {
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

    const supabase = getSupabaseAdmin();
    if (!supabase) return supabaseUnavailableResponse();

    const { data: logs, error } = await supabase
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
