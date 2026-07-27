import { useState } from 'react'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'

// Shown after a password-reset email link is opened — Supabase has put the
// user in a temporary recovery session, so they just set a new password.
export default function ResetPassword() {
  const { endRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)

  const inputCls =
    'w-full px-3 py-2.5 text-sm bg-surface border border-line-strong rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/30 placeholder:text-faint'

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setDone(true)
    // Clean the recovery token out of the URL, then drop into the app.
    setTimeout(() => {
      window.history.replaceState({}, '', window.location.pathname)
      endRecovery()
    }, 1200)
  }

  return (
    <div className="min-h-full bg-ground flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center font-bold text-accent-ink">T</div>
          <div className="text-lg font-bold text-ink">Talaash HQ</div>
        </div>
        <form onSubmit={submit} className="bg-surface rounded-2xl border border-line shadow-sm p-5">
          <h1 className="text-base font-semibold text-ink mb-1">Set a new password</h1>
          <p className="text-xs text-muted mb-4">Pick something you'll remember — you're already signed in via the email link.</p>
          <input
            type="password" required minLength={6} autoFocus autoComplete="new-password"
            className={inputCls} placeholder="New password (min 6 characters)"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          {err && <p className="text-sm text-bad mt-3">{err}</p>}
          {done ? (
            <p className="text-sm text-good mt-3 font-medium">✓ Password updated — taking you in…</p>
          ) : (
            <button
              type="submit" disabled={busy || password.length < 6}
              className="w-full mt-4 py-2.5 rounded-xl bg-accent text-accent-ink font-semibold text-sm hover:bg-accent-strong transition-colors cursor-pointer disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Update password'}
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
