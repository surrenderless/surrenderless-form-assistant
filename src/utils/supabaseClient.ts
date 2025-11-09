// src/utils/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

// ✅ Public client (browser-safe)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! || process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ✅ Admin client (server only — do NOT import from client code)
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch },
});

// ⚠️ Removed console logs of secrets
