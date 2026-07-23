import { useState } from 'react'
import { supabase } from '../supabase.js'

export default function Login() {
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // {kind: 'error'|'info', text}

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        // session change re-renders the app
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) {
          setMsg({
            kind: 'info',
            text: 'Account created — check your email for a confirmation link, then sign in.',
          })
          setMode('signin')
        }
      }
    } catch (err) {
      setMsg({ kind: 'error', text: err.message || 'Something went wrong.' })
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full px-3 py-2.5 text-sm bg-surface border border-line-strong rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/30 placeholder:text-faint'

  return (
    <div className="min-h-full bg-ground flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center font-bold text-accent-ink">T</div>
          <div>
            <div className="text-lg font-bold text-ink leading-tight">Talaash HQ</div>
            <div className="text-[11px] text-muted">DDN team manager</div>
          </div>
        </div>

        <form onSubmit={submit} className="bg-surface rounded-2xl border border-line shadow-sm p-5">
          <h1 className="text-base font-semibold text-ink mb-4">
            {mode === 'signin' ? 'Sign in' : 'Create your account'}
          </h1>
          <label className="block mb-3">
            <span className="block text-xs font-medium text-muted mb-1">Email</span>
            <input
              type="email" required autoComplete="email" className={inputCls}
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block mb-4">
            <span className="block text-xs font-medium text-muted mb-1">Password</span>
            <input
              type="password" required minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className={inputCls}
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {msg && (
            <p className={`text-sm mb-3 ${msg.kind === 'error' ? 'text-bad' : 'text-good'}`}>
              {msg.text}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-xl bg-accent text-accent-ink font-semibold text-sm hover:bg-accent-strong transition-colors cursor-pointer disabled:opacity-40"
          >
            {busy ? 'One sec…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
          </button>

          <p className="text-xs text-muted text-center mt-4">
            {mode === 'signin' ? (
              <>New here?{' '}
                <button type="button" className="font-semibold text-ink hover:underline cursor-pointer" onClick={() => { setMode('signup'); setMsg(null) }}>
                  Create an account
                </button>
              </>
            ) : (
              <>Already have an account?{' '}
                <button type="button" className="font-semibold text-ink hover:underline cursor-pointer" onClick={() => { setMode('signin'); setMsg(null) }}>
                  Sign in
                </button>
              </>
            )}
          </p>
        </form>

        <p className="text-center text-[11px] text-faint mt-4">
          New accounts start as viewers — a board member can make you an editor.
        </p>
      </div>
    </div>
  )
}
