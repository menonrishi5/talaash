import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Session + role context. Roles are enforced by row-level security in the
// database; the `canEdit` flag here only decides what UI to show.

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)
  // True after a password-reset link is opened, until they set a new password.
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) {
      setProfile(null)
      return
    }
    let alive = true
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setProfile(data)
      })
    return () => {
      alive = false
    }
  }, [session?.user?.id])

  const value = {
    loading: session === undefined,
    session: session ?? null,
    profile,
    role: profile?.role ?? 'viewer',
    canEdit: profile?.role === 'editor',
    memberId: profile?.member_id ?? null, // linked roster member, set in App access
    recovery,
    endRecovery: () => setRecovery(false),
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
