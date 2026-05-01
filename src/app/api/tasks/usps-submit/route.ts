// src/app/api/tasks/usps-submit/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/utils/supabaseClient';
import { runCrewBridge } from '@/server/CrewBridge';
import { rateLimit } from '@/utils/rateLimiter';
import { getUserOr401 } from '@/server/requireUser';

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 /api/tasks/usps-submit hit');

    const userId = getUserOr401(request);
    if (!userId) {
      console.warn('⛔ Unauthorized');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // rate limit (10 req/min per user). Fail-open if Redis has an issue.
    try {
      if (await rateLimit(userId)) {
        console.warn('🚧 Rate limit exceeded');
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
      }
    } catch (e) {
      console.warn('⚠️ Rate limit check failed, allowing request:', (e as any)?.message);
    }

    const supabase = supabaseAdmin;

    // load profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (profileError || !profile) {
      console.warn('⚠️ Profile load failed:', profileError?.message);
      return NextResponse.json(
        { error: profileError?.message || 'User profile not found' },
        { status: 404 }
      );
    }
    console.log('✅ Profile loaded:', { id: profile.id, email: profile.email });

    // create task log
    const { data: log, error: logError } = await supabase
      .from('task_logs')
      .insert([
        {
          user_id: userId,
          task_type: 'usps_change_address',
          status: 'in_progress',
          steps: [],
        },
      ])
      .select()
      .maybeSingle();

    if (logError || !log) {
      console.error('❌ Task log create failed:', logError?.message);
      throw new Error('Could not create task log');
    }
    console.log('🧾 Task log created:', { id: log.id });

    // run task
    try {
      const result = await runCrewBridge({
        url: 'https://www.usps.com/move/',
        userData: {
          name: profile.name,
          address: profile.address || '123 Main St',
          email: profile.email,
        },
        logStep: async (step) => {
          await supabase
            .from('task_logs')
            .update({ steps: [...(log.steps || []), { step, time: Date.now() }] })
            .eq('id', log.id);
          console.log('🪵 step:', step);
        },
      });

      await supabase
        .from('task_logs')
        .update({ status: 'success', result_summary: 'Successfully submitted USPS form' })
        .eq('id', log.id);

      await supabase.from('history').insert({
        user_id: userId,
        action: 'usps-submit',
        result,
      });

      console.log('🎉 USPS flow success');
      return NextResponse.json({ message: 'USPS address submitted successfully', result });
    } catch (taskErr: any) {
      console.error('💥 USPS flow failed:', taskErr?.message || taskErr);
      await supabase
        .from('task_logs')
        .update({ status: 'failed', result_summary: 'Error during USPS submission' })
        .eq('id', log.id);
      throw taskErr;
    }
  } catch (error: any) {
    console.error('Error in /api/tasks/usps-submit:', error);
    return NextResponse.json({ error: error?.message || 'Task failed' }, { status: 500 });
  }
}
