import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabase;
try {
  if (!supabaseUrl) throw new Error('supabaseUrl is required');
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} catch (e) {
  console.warn('Supabase not configured:', e.message);
  const noop = () => noopClient;
  const noopClient = new Proxy(noop, {
    get: () => noopClient,
    apply: () => Promise.resolve({ data: { session: null, user: null }, error: null }),
  });
  supabase = noopClient;
}

export { supabase };
