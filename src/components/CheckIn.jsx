import { useEffect, useState } from 'react'
import { supabase, fmtTeamTime } from '../supabase.js'

// Public check-in page (#/checkin?t=…) — what the QR code / Slack link opens.
// Check-in is tied to the signed-in account: you check in as yourself, so
// nobody can tap in a late teammate. The `t` token in the URL is what proves
// presence — it's minted fresh per session and only ever travels inside the
// QR/link the board posts at practice, so there's nothing to type or read
// aloud, and an old screenshot stops working the moment that session ends.

const money = (n) => `$${Number(n) % 1 ? Number(n).toFixed(2) : Number(n)}`
const APP_URL = () => `${window.location.origin}${window.location.pathname}`
const getToken = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('t')

export default function CheckIn() {
  const [phase, setPhase] = useState('loading') // loading | signin | none | closed | unlinked | notoken | form | done | error
  const [authed, setAuthed] = useState(null) // session user
  const [myName, setMyName] = useState(null)
  const [session, setSession] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState(null)
  const [result, setResult] = useState(null)

  const boot = async () => {
    setPhase('loading')
    try {
      const { data: authData } = await supabase.auth.getSession()
      const user = authData.session?.user ?? null
      setAuthed(user)
      if (!user) {
        setPhase('signin')
        return
      }
      const [{ data: info, error: e1 }, { data: profile }] = await Promise.all([
        supabase.rpc('get_checkin_info'),
        supabase.from('profiles').select('member_id').eq('id', user.id).maybeSingle(),
      ])
      if (e1) throw e1
      if (!profile?.member_id) {
        setPhase('unlinked')
        return
      }
      const me = (info.roster ?? []).find((m) => m.id === profile.member_id)
      setMyName(me?.name ?? 'you')
      if (!info.session) {
        setPhase('none')
        return
      }
      if (info.session.ended) {
        setPhase('closed')
        return
      }
      if (!getToken()) {
        setPhase('notoken')
        return
      }
      setSession(info.session)
      setPhase('form')
    } catch (e) {
      console.error(e)
      setPhase('error')
    }
  }

  useEffect(() => {
    boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setErrMsg(null)
    try {
      const { data, error } = await supabase.rpc('check_in', {
        p_session: session.id,
        p_token: getToken(),
      })
      if (error) throw error
      if (!data.ok) {
        setErrMsg(data.error)
      } else {
        setResult(data)
        setPhase('done')
      }
    } catch (e) {
      console.error(e)
      setErrMsg('Something went wrong — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full bg-ground flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center font-bold text-accent-ink text-sm">T</div>
          <div className="text-lg font-bold text-ink">Talaash practice check-in</div>
        </div>

        {phase === 'loading' && <Panel><p className="text-sm text-faint text-center">Loading…</p></Panel>}

        {phase === 'error' && (
          <Panel>
            <p className="text-sm text-bad text-center">Couldn't connect — check your internet and refresh.</p>
          </Panel>
        )}

        {phase === 'signin' && <SignInPanel onSignedIn={boot} />}

        {phase === 'unlinked' && (
          <Panel>
            <p className="text-3xl text-center mb-2">🔗</p>
            <p className="text-sm text-muted text-center font-medium">
              Your account isn't linked to a roster member yet.
            </p>
            <p className="text-xs text-faint text-center mt-1">
              Ask a board member to link it (they can also check you in manually today).
            </p>
          </Panel>
        )}

        {phase === 'none' && (
          <Panel>
            <p className="text-3xl text-center mb-2">😴</p>
            <p className="text-sm text-muted text-center font-medium">No check-in is open today.</p>
            <p className="text-xs text-faint text-center mt-1">
              A board member starts the session when practice is on.
            </p>
          </Panel>
        )}

        {phase === 'closed' && (
          <Panel>
            <p className="text-3xl text-center mb-2">🏁</p>
            <p className="text-sm text-muted text-center font-medium">Check-in is closed for today.</p>
            <p className="text-xs text-faint text-center mt-1">
              Talk to a board member if you made it but didn't get to check in.
            </p>
          </Panel>
        )}

        {phase === 'notoken' && (
          <Panel>
            <p className="text-3xl text-center mb-2">🔗</p>
            <p className="text-sm text-muted text-center font-medium">This link is missing today's check-in code.</p>
            <p className="text-xs text-faint text-center mt-1">
              Scan the QR posted at practice, or open the link the board shared — don't reuse an old one.
            </p>
          </Panel>
        )}

        {phase === 'form' && (
          <Panel>
            <p className="text-sm text-ink mb-4 text-center">
              Checking in as <span className="font-bold">{myName}</span>
              <button
                className="block mx-auto mt-0.5 text-[11px] text-faint underline cursor-pointer"
                onClick={async () => { await supabase.auth.signOut(); boot() }}
              >
                not you? switch account
              </button>
            </p>

            {errMsg && <p className="text-sm text-bad mb-3 text-center">{errMsg}</p>}

            <button
              onClick={submit}
              disabled={busy}
              className="w-full py-3 rounded-xl bg-accent text-accent-ink font-semibold text-sm hover:bg-accent-strong transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Checking in…' : `Check in as ${myName}`}
            </button>
          </Panel>
        )}

        {phase === 'done' && result && (
          <Panel>
            {result.already ? (
              <>
                <p className="text-4xl text-center mb-2">👍</p>
                <p className="text-center font-semibold text-ink">You already checked in</p>
                <p className="text-center text-sm text-muted mt-1">at {fmtTeamTime(result.checked_at)}</p>
              </>
            ) : Number(result.fine) > 0 ? (
              <>
                <p className="text-4xl text-center mb-2">😬</p>
                <p className="text-center font-semibold text-ink">
                  Checked in at {fmtTeamTime(result.checked_at)} — {result.mins_late} min late
                </p>
                <p className="text-center text-2xl font-black text-bad mt-2">{money(result.fine)} fine</p>
                <p className="text-center text-xs text-faint mt-1">added to your running total</p>
              </>
            ) : (
              <>
                <p className="text-4xl text-center mb-2">✅</p>
                <p className="text-center font-semibold text-good">
                  You're in — {fmtTeamTime(result.checked_at)}
                </p>
                {result.mins_late > 0 && (
                  <p className="text-center text-xs text-faint mt-1">
                    {result.mins_late} min past cutoff, within grace — no fine
                  </p>
                )}
              </>
            )}
          </Panel>
        )}

        <p className="text-center text-[11px] text-faint mt-4">Talaash HQ</p>
      </div>
    </div>
  )
}

function SignInPanel({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const signIn = async () => {
    if (busy) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setErr(error.message)
    else onSignedIn()
  }

  const inputCls =
    'w-full px-3 py-2.5 text-sm bg-surface border border-line-strong rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/30 placeholder:text-faint'

  return (
    <Panel>
      <p className="text-sm text-ink font-medium text-center mb-1">Sign in to check in</p>
      <p className="text-xs text-faint text-center mb-4">
        Check-in is tied to your own account — no checking in your friends 👀
      </p>
      <div className="space-y-3 mb-4">
        <input type="email" className={inputCls} placeholder="Email" autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" className={inputCls} placeholder="Password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && signIn()} />
      </div>
      {err && <p className="text-sm text-bad mb-3 text-center">{err}</p>}
      <button
        onClick={signIn}
        disabled={busy || !email || !password}
        className="w-full py-3 rounded-xl bg-accent text-accent-ink font-semibold text-sm hover:bg-accent-strong transition-colors cursor-pointer disabled:opacity-40"
      >
        {busy ? 'One sec…' : 'Sign in'}
      </button>
      <p className="text-[11px] text-faint text-center mt-3">
        No account yet? <a className="underline" href={APP_URL()}>Create one here</a>, then come back.
      </p>
    </Panel>
  )
}

function Panel({ children }) {
  return (
    <div className="bg-surface rounded-2xl border border-line shadow-sm p-5">{children}</div>
  )
}
