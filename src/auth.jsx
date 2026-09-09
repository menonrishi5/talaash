import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Session + role context. Roles are enforced by row-level security in the
// database; the `canEdit` flag here only decides what UI to show.

const AuthCtx = createContext(null)

// The owner (Rishi) is the only one who can grant/revoke admin access.
// Enforced in the database too (migration-16); this just gates the UI.
const OWNER_EMAILS = ['menonrishi5@gmail.com', 'rishimenon@utexas.edu']

// Was this page opened from a password-reset email link? supabase-js starts
// parsing (and stripping) the URL the moment the client is created in
// supabase.js — before this provider mounts — so its PASSWORD_RECOVERY event
// often fires before onAuthStateChange is even subscribed and is missed,
// which is why "forgot password" used to just silently sign the user in.
// Detect it straight from the URL instead, and stash it so it survives the
// hashchange reload in main.jsx.
const RECOVERY_FLAG = 'talaash-pw-recovery'
const urlHasRecovery = () => {
  const h = window.location.hash || ''
  const q = window.location.search || ''
  return /[#&?]type=recovery(?:&|$)/.test(h) || new URLSearchParams(q).get('type') === 'recovery'
}
function detectRecovery() {
  try {
    if (urlHasRecovery()) {
      sessionStorage.setItem(RECOVERY_FLAG, '1')
      return true
    }
    return sessionStorage.getItem(RECOVERY_FLAG) === '1'
  } catch {
    return urlHasRecovery()
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)
  const [profileLoaded, setProfileLoaded] = useState(false) // fetch has completed (row or not)
  // True after a password-reset link is opened, until they set a new password.
  const [recovery, setRecovery] = useState(detectRecovery)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        try { sessionStorage.setItem(RECOVERY_FLAG, '1') } catch { /* ignore */ }
        setRecovery(true)
      }
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) {
      setProfile(null)
      setProfileLoaded(false)
      return
    }
    let alive = true
    setProfileLoaded(false)
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) console.error('Could not load your profile — role/links unavailable.', error)
        setProfile(data)
        setProfileLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [session?.user?.id])

  const isOwner = OWNER_EMAILS.includes((session?.user?.email ?? '').toLowerCase())
  // Owner accounts bootstrap as editor (migration-2) and can't be demoted by
  // anyone but themselves — so if an owner's profile row genuinely failed to
  // load (error, or RLS hiding it), fall back to editor rather than stranding
  // them. But when the row DID load and says 'viewer', respect it — that's a
  // deliberate choice (e.g. previewing the member experience).
  const ownerFallback = isOwner && profileLoaded && !profile

  const value = {
    loading: session === undefined,
    session: session ?? null,
    profile,
    role: profile?.role ?? (ownerFallback ? 'editor' : 'viewer'),
    canEdit: profile ? profile.role === 'editor' : ownerFallback,
    memberId: profile?.member_id ?? null, // linked roster member, set in App access
    isOwner,
    recovery,
    endRecovery: () => {
      try { sessionStorage.removeItem(RECOVERY_FLAG) } catch { /* ignore */ }
      setRecovery(false)
    },
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
