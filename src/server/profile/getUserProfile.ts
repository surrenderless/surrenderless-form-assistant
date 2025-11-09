import { supabase } from '@/utils/supabaseClient';

export async function getUserProfile(userId: string) {
  console.log('🔍 Looking for user_id:', userId); // Debug log

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId) // Confirm this matches column name exactly
    .single();

  if (error) console.error('❌ Supabase error:', error); // Extra debug

  if (!data) throw new Error('User profile not found');

  return {
    name: data.name,
    address: data.address,
    email: data.email,
  };
}
