import { createClient } from '@supabase/supabase-js';
let client;
export function getSupabaseClient() {
  if (client) return client;
  const url = import.meta.env?.VITE_SUPABASE_URL;
  const key = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart Vite.');
  if (!key.startsWith('sb_publishable_')) throw new Error('Use a Supabase publishable key. Secret and service-role keys must never be used in this app.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(parsed.hostname)) throw new Error('Supabase must use HTTPS outside local development.');
  client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  return client;
}
