// Clerk-compatible auth adapter over Supabase Auth.
//
// Exposes the small slice of Clerk's API the app used (useUser/SignedIn/
// SignedOut) so call sites keep working with a one-line import swap. `user.id`
// is the Supabase auth.users UUID; `user.primaryEmailAddress.emailAddress` is
// the email — matching the shapes the components already read.
import { type ReactNode } from 'react'
import { useSupabaseUser, getSupabase } from '@escapesuite/shared/auth'

export interface AdaptedUser {
  id: string
  email: string
  firstName: string | null
  primaryEmailAddress: { emailAddress: string }
}

export function useUser(): {
  user: AdaptedUser | null
  isLoaded: boolean
  isSignedIn: boolean
} {
  const { user, loading } = useSupabaseUser()
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const firstName =
    (meta.first_name as string | undefined) ??
    (meta.full_name as string | undefined)?.split(' ')[0] ??
    (meta.name as string | undefined)?.split(' ')[0] ??
    null
  return {
    isLoaded: !loading,
    isSignedIn: !!user,
    user: user
      ? {
          id: user.id,
          email: user.email ?? '',
          firstName,
          primaryEmailAddress: { emailAddress: user.email ?? '' },
        }
      : null,
  }
}

export function SignedIn({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useUser()
  if (!isLoaded) return null
  return isSignedIn ? <>{children}</> : null
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useUser()
  if (!isLoaded) return null
  return isSignedIn ? null : <>{children}</>
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut()
}
