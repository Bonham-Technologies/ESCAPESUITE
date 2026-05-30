// Single Supabase browser client (auth + data) shared across all SaaS-mode apps.
//
// Created lazily so standalone/air-gapped builds (which never call this) don't
// require Supabase env vars at import time. In production all three apps are
// served from one origin, so the localStorage-persisted session is shared
// automatically between /, /craft and /artist.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (client) return client
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Missing Supabase env: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'
    )
  }
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  })
  return client
}
