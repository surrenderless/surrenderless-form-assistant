// src/app/api/task-logs/rerun/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/utils/supabaseClient";
import { getUserProfile } from "@/server/profile/getUserProfile";
import { runCrewBridge } from "@/server/crewBridge";
import { rateLimit } from "@/utils/rateLimiter";
import { getUserOr401 } from "@/server/requireUser";

export async function POST(req: Request) {
  try {
    // auth
    const userId = getUserOr401();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // rate limit (10/min per user). Fail-open on Redis error.
    try {
      if (await rateLimit(userId)) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
      }
    } catch (e: any) {
      console.warn("rateLimit failed, allowing:", e?.message);
    }

    const { logId } = await req.json();
    if (!logId) return NextResponse.json({ error: "Missing logId" }, { status: 400 });

    const { data: log, error: logErr } = await supabase
      .from("task_logs")
      .select("*")
      .eq("id", logId)
      .maybeSingle();

    if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 });
    if (!log) return NextResponse.json({ error: "Log not found" }, { status: 404 });
    if (log.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const userProfile = await getUserProfile(log.user_id);
    if (!userProfile) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

    await runCrewBridge({
      url: log.url,
      userData: {
        name: userProfile.name,
        address: userProfile.address,
        email: userProfile.email,
      },
      logStep: async (step: string) => {
        await supabase
          .from("task_logs")
          .update({ steps: [...(log.steps || []), { step, time: Date.now() }] })
          .eq("id", log.id);
      },
    });

    return NextResponse.json({ status: "restarted" });
  } catch (error: any) {
    console.error("Error in /api/task-logs/rerun:", error);
    return NextResponse.json({ error: error?.message || "Task rerun failed" }, { status: 500 });
  }
}
