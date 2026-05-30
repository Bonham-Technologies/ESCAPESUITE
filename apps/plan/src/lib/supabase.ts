// Plan app's Supabase client — the single shared browser client (auth + data).
import { getSupabase } from '@escapesuite/shared/auth'

export const supabase = getSupabase()

// Edge Function base URL + anon key (kept for any direct fetch helpers).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const functionsUrl = `${supabaseUrl}/functions/v1`
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
