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
    'w-full px-3 py-2.5 text-sm bg-white border border-zinc-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-400/40 placeholder:text-zinc-400'

  return (
    <div className="min-h-full bg-zinc-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center font-bold text-white">T</div>
          <div>
            <div className="text-lg font-bold text-zinc-900 leading-tight">Talaash HQ</div>
            <div className="text-[11px] text-zinc-500">DDN team manager</div>
          </div>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
          <h1 className="text-base font-semibold text-zinc-900 mb-4">
            {mode === 'signin' ? 'Sign in' : 'Create your account'}
          </h1>
          <label className="block mb-3">
            <span className="block text-xs font-medium text-zinc-500 mb-1">Email</span>
            <input
              type="email" required autoComplete="email" className={inputCls}
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block mb-4">
            <span className="block text-xs font-medium text-zinc-500 mb-1">Password</span>
            <input
              type="password" required minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className={inputCls}
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {msg && (
            <p className={`text-sm mb-3 ${msg.kind === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
              {msg.text}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-xl bg-zinc-900 text-white font-semibold text-sm hover:bg-zinc-700 transition-colors cursor-pointer disabled:opacity-40"
          >
            {busy ? 'One sec…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
          </button>

          <p className="text-xs text-zinc-500 text-center mt-4">
            {mode === 'signin' ? (
              <>New here?{' '}
                <button type="button" className="font-semibold text-zinc-800 hover:underline cursor-pointer" onClick={() => { setMode('signup'); setMsg(null) }}>
                  Create an account
                </button>
              </>
            ) : (
              <>Already have an account?{' '}
                <button type="button" className="font-semibold text-zinc-800 hover:underline cursor-pointer" onClick={() => { setMode('signin'); setMsg(null) }}>
                  Sign in
                </button>
              </>
            )}
          </p>
        </form>

        <p className="text-center text-[11px] text-zinc-400 mt-4">
          New accounts start as viewers — a board member can make you an editor.
        </p>
      </div>
    </div>
  )
}
