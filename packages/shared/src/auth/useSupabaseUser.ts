// Reactive Supabase auth state. Self-contained hook (no provider needed):
// reads the current session on mount and subscribes to auth changes.
import { useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { getSupabase } from './supabaseClient'

export interface SupabaseUserState {
  user: User | null
  session: Session | null
  loading: boolean
}

export function useSupabaseUser(): SupabaseUserState {
  const [state, setState] = useState<SupabaseUserState>({
    user: null,
    session: null,
    loading: true,
  })

  useEffect(() => {
    const supabase = getSupabase()
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setState({
        user: data.session?.user ?? null,
        session: data.session ?? null,
        loading: false,
      })
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        user: session?.user ?? null,
        session: session ?? null,
        loading: false,
      })
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return state
}
