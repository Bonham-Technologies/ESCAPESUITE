// Authentication helpers shared by all edge functions.
//
// The migration's core security fix: identity is derived from the caller's
// VERIFIED Supabase JWT (Authorization: Bearer <access_token>, attached
// automatically by supabase-js functions.invoke), never from the request body.
// This makes the old IDOR class ("swap the userId in the body") impossible.
import {
  createClient,
  type SupabaseClient,
  type User,
} from 'https://esm.sh/@supabase/supabase-js@2.39.0'

export class AuthError extends Error {
  status: number
  constructor(message: string, status = 401) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

/** Service-role client: bypasses RLS. Use only for genuinely privileged work. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * Verify the caller's bearer token and return the authenticated user.
 * Throws AuthError (401) if the token is missing, the anon key, or invalid.
 */
export async function requireUser(req: Request): Promise<User> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new AuthError('Missing authorization token')

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )

  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user) throw new AuthError('Invalid or expired session')
  return data.user
}
