import { useEffect, useMemo, useState } from 'react'
import { supabase, todayTeamISO, fmtTeamTime } from '../supabase.js'

// Public check-in page (#/checkin) — what the QR code / Slack link opens.
// Standalone: no StoreProvider, minimal chrome, phone-first layout.

const money = (n) => `$${Number(n) % 1 ? Number(n).toFixed(2) : Number(n)}`

export default function CheckIn() {
  const [phase, setPhase] = useState('loading') // loading | none | form | done | error
  const [session, setSession] = useState(null)
  const [roster, setRoster] = useState([])
  const [password, setPassword] = useState('')
  const [query, setQuery] = useState('')
  const [memberId, setMemberId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [{ data: sess, error: e1 }, { data: rosterRow, error: e2 }] = await Promise.all([
          supabase.from('attendance_sessions').select('id, session_date').eq('session_date', todayTeamISO()).maybeSingle(),
          supabase.from('app_state').select('data').eq('key', 'roster').maybeSingle(),
        ])
        if (e1 || e2) throw e1 || e2
        if (!sess) {
          setPhase('none')
          return
        }
        setSession(sess)
        setRoster((rosterRow?.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)))
        setPhase('form')
      } catch (e) {
        console.error(e)
        setPhase('error')
      }
    })()
  }, [])

  const visible = useMemo(
    () => roster.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())),
    [roster, query],
  )
  const member = roster.find((m) => m.id === memberId)

  const submit = async () => {
    if (!member || !password.trim() || busy) return
    setBusy(true)
    setErrMsg(null)
    try {
      const { data, error } = await supabase.rpc('check_in', {
        p_session: session.id,
        p_member_id: member.id,
        p_member_name: member.name,
        p_password: password,
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
    <div className="min-h-full bg-zinc-100 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="w-9 h-9 rounded-xl bg-zinc-900 flex items-center justify-center font-bold text-white text-sm">T</div>
          <div className="text-lg font-bold text-zinc-900">Talaash practice check-in</div>
        </div>

        {phase === 'loading' && <Panel><p className="text-sm text-zinc-400 text-center">Loading…</p></Panel>}

        {phase === 'error' && (
          <Panel>
            <p className="text-sm text-red-600 text-center">
              Couldn't connect — check your internet and refresh.
            </p>
          </Panel>
        )}

        {phase === 'none' && (
          <Panel>
            <p className="text-3xl text-center mb-2">😴</p>
            <p className="text-sm text-zinc-600 text-center font-medium">No check-in is open today.</p>
            <p className="text-xs text-zinc-400 text-center mt-1">
              A board member starts the session when practice is on.
            </p>
          </Panel>
        )}

        {phase === 'form' && (
          <Panel>
            <label className="block mb-4">
              <span className="block text-xs font-medium text-zinc-500 mb-1">Today's password</span>
              <input
                className="w-full px-3 py-2.5 text-base bg-white border border-zinc-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-400/40 tracking-widest font-semibold uppercase placeholder:normal-case placeholder:font-normal placeholder:tracking-normal placeholder:text-zinc-400"
                placeholder="announced at practice"
                value={password}
                autoCapitalize="none"
                autoCorrect="off"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            <span className="block text-xs font-medium text-zinc-500 mb-1">Who are you?</span>
            <input
              className="w-full px-3 py-2 text-sm bg-white border border-zinc-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-400/40 mb-2 placeholder:text-zinc-400"
              placeholder="Search your name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto thin-scroll rounded-xl border border-zinc-200 divide-y divide-zinc-100 mb-4 bg-white">
              {visible.length === 0 && (
                <p className="text-xs text-zinc-400 italic p-3">No names match — ask a board member to add you to the roster.</p>
              )}
              {visible.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMemberId(m.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left cursor-pointer transition-colors ${
                    memberId === m.id ? 'bg-zinc-900 text-white font-semibold' : 'hover:bg-zinc-50 text-zinc-800'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] shrink-0 ${
                    memberId === m.id ? 'bg-white text-zinc-900 border-white' : 'border-zinc-300'
                  }`}>
                    {memberId === m.id ? '✓' : ''}
                  </span>
                  {m.name}
                </button>
              ))}
            </div>

            {errMsg && <p className="text-sm text-red-600 mb-3 text-center">{errMsg}</p>}

            <button
              onClick={submit}
              disabled={!member || !password.trim() || busy}
              className="w-full py-3 rounded-xl bg-zinc-900 text-white font-semibold text-sm hover:bg-zinc-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Checking in…' : member ? `Check in as ${member.name}` : 'Check in'}
            </button>
          </Panel>
        )}

        {phase === 'done' && result && (
          <Panel>
            {result.already ? (
              <>
                <p className="text-4xl text-center mb-2">👍</p>
                <p className="text-center font-semibold text-zinc-800">You already checked in</p>
                <p className="text-center text-sm text-zinc-500 mt-1">at {fmtTeamTime(result.checked_at)}</p>
              </>
            ) : Number(result.fine) > 0 ? (
              <>
                <p className="text-4xl text-center mb-2">😬</p>
                <p className="text-center font-semibold text-zinc-800">
                  Checked in at {fmtTeamTime(result.checked_at)} — {result.mins_late} min late
                </p>
                <p className="text-center text-2xl font-black text-red-600 mt-2">{money(result.fine)} fine</p>
                <p className="text-center text-xs text-zinc-400 mt-1">added to your running total</p>
              </>
            ) : (
              <>
                <p className="text-4xl text-center mb-2">✅</p>
                <p className="text-center font-semibold text-emerald-700">
                  You're in — {fmtTeamTime(result.checked_at)}
                </p>
                {result.mins_late > 0 && (
                  <p className="text-center text-xs text-zinc-400 mt-1">
                    {result.mins_late} min past cutoff, within grace — no fine
                  </p>
                )}
              </>
            )}
          </Panel>
        )}

        <p className="text-center text-[11px] text-zinc-400 mt-4">Talaash HQ</p>
      </div>
    </div>
  )
}

function Panel({ children }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">{children}</div>
  )
}
