import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase, todayTeamISO, fmtTeamTime } from '../supabase.js'
import { minToLabel, fmtDate } from '../lib.js'
import { isActive, buildMatcher } from '../matching.js'
import { Button, Card, CardHeader, Modal, Field, Select, TextInput, Badge, EmptyState, ViewToggle, inputCls } from './ui.jsx'

const money = (n) => `$${Number(n) % 1 ? Number(n).toFixed(2) : Number(n)}`

const WORDS = [
  'tiger', 'garba', 'bolly', 'dhoom', 'jalwa', 'mirchi', 'desi', 'tashan',
  'bhangra', 'chakde', 'nachle', 'thumka', 'raaga', 'dholak', 'sitar', 'mehfil',
  'jhoom', 'masti', 'rangla', 'sapna', 'josh', 'lehar',
]
const word = () => WORDS[Math.floor(Math.random() * WORDS.length)]
// Two words + 2 digits: still announceable ("tiger-jhoom-47") but far more
// than the old ~1k space, so it can't be guessed/scripted from home.
const genPassword = () => `${word()}-${word()}-${Math.floor(10 + Math.random() * 90)}`

function checkInURL() {
  return `${window.location.origin}${window.location.pathname}#/checkin`
}

const timeOpts = []
for (let m = 16 * 60; m <= 23 * 60; m += 15) timeOpts.push(m)

export default function Attendance() {
  const { canEdit, memberId } = useAuth()
  const [view, setView] = useState('team')
  // Members see their own attendance + fines; the database only returns
  // their own rows anyway.
  if (!canEdit) return <MyAttendance />
  // Editors are dancers too: admin dashboard by default, with a flip to
  // their own check-in history + fines (if their account is linked).
  return (
    <>
      {memberId && (
        <div className="flex justify-end mb-4">
          <ViewToggle value={view} onChange={setView} options={[['team', 'Team'], ['mine', 'My attendance']]} />
        </div>
      )}
      {view === 'mine' ? <MyAttendance /> : <AttendanceAdmin />}
    </>
  )
}

// ---- viewer view ----
function MyAttendance() {
  const { memberId } = useAuth()
  const [checkins, setCheckins] = useState(null)
  const [pays, setPays] = useState([])
  const [todaySession, setTodaySession] = useState(null)

  useEffect(() => {
    ;(async () => {
      const [{ data: c }, { data: p }, { data: s }] = await Promise.all([
        supabase
          .from('checkins')
          .select('*, attendance_sessions(session_date)')
          .order('checked_at', { ascending: false }),
        supabase.from('payments').select('*'),
        supabase
          .from('attendance_sessions')
          .select('id, session_date')
          .eq('session_date', todayTeamISO())
          .maybeSingle(),
      ])
      setCheckins(c ?? [])
      setPays(p ?? [])
      setTodaySession(s)
    })()
  }, [])

  const fined = (checkins ?? []).reduce((n, c) => n + Number(c.fine), 0)
  const paid = pays.reduce((n, p) => n + Number(p.amount), 0)
  const due = Math.max(0, fined - paid)
  const late = (checkins ?? []).filter((c) => c.mins_late > 0).length

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink mb-1">My Attendance</h1>
        <p className="text-sm text-muted">Your check-ins and fines — only you and the board see this.</p>
      </div>

      {todaySession && (
        <Card className="mb-5">
          <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Practice check-in is open today</p>
              <p className="text-xs text-muted">Use the password announced at practice.</p>
            </div>
            <Button variant="primary" onClick={() => window.open(checkInURL(), '_blank')}>
              Check in now
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          ['Practices attended', checkins ? checkins.filter((c) => !c.no_show).length : '—'],
          ['Times late', late],
          ['Total fines', money(fined)],
          ['Outstanding', due > 0 ? money(due) : '$0 ✓'],
        ].map(([label, value]) => (
          <Card key={label}>
            <div className="px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-faint font-medium">{label}</div>
              <div className={`text-xl font-bold ${label === 'Outstanding' && due > 0 ? 'text-bad' : 'text-ink'}`}>{value}</div>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="History" />
        {!memberId ? (
          <p className="px-5 pb-5 text-sm text-muted">
            Your account isn't linked to a roster member yet — ask a board member to link it
            (Roster → App access) and your history will appear here.
          </p>
        ) : checkins === null ? (
          <p className="px-5 pb-5 text-sm text-faint">Loading…</p>
        ) : checkins.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-faint italic">No check-ins yet.</p>
        ) : (
          <ul className="px-5 pb-5 divide-y divide-line">
            {checkins.map((c) => (
              <li key={c.id} className="py-2 flex items-center gap-3 text-sm">
                <span className="text-muted text-xs w-20">
                  {c.attendance_sessions?.session_date ? fmtDate(c.attendance_sessions.session_date) : '—'}
                </span>
                <span className="flex-1 text-ink">
                  {c.no_show ? 'did not check in' : `checked in ${fmtTeamTime(c.checked_at)}`}
                </span>
                {c.no_show
                  ? (Number(c.fine) > 0
                      ? <Badge className="bg-bad-soft text-bad">no-show</Badge>
                      : <Badge className="bg-subtle text-muted">excused</Badge>)
                  : c.mins_late > 0
                    ? <Badge className="bg-warn-soft text-warn">{c.mins_late} min late</Badge>
                    : <Badge className="bg-good-soft text-good">on time</Badge>}
                {Number(c.fine) > 0 && <span className="font-semibold text-bad">{money(c.fine)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function AttendanceAdmin() {
  const { canEdit } = useAuth()
  const todayISO = todayTeamISO()
  const [session, setSession] = useState(null) // today's session row, or null
  const [checkins, setCheckins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [payModal, setPayModal] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const { data: sess, error: e1 } = await supabase
        .from('attendance_sessions')
        .select('*')
        .eq('session_date', todayISO)
        .maybeSingle()
      if (e1) throw e1
      // Password lives in the editor-only secrets table; attach it for display.
      if (sess) {
        const { data: secret } = await supabase
          .from('session_secrets')
          .select('password')
          .eq('session_id', sess.id)
          .maybeSingle()
        sess.password = secret?.password ?? ''
      }
      setSession(sess)
      if (sess) {
        const { data: rows, error: e2 } = await supabase
          .from('checkins')
          .select('*')
          .eq('session_id', sess.id)
          .order('checked_at')
        if (e2) throw e2
        setCheckins(rows)
      } else {
        setCheckins([])
      }
      setError(null)
    } catch (e) {
      console.error(e)
      setError('Could not reach the database. Has the schema been set up?')
    } finally {
      setLoading(false)
    }
  }, [todayISO])

  // Poll while this tab is open so check-ins appear live.
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 10000)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1">Attendance</h1>
          <p className="text-sm text-muted">
            Check-in link + rotating password per practice; fines compute on the server clock.
          </p>
        </div>
        {canEdit && <Button size="sm" onClick={() => setPayModal(true)}>Record payment</Button>}
      </div>

      {error && (
        <div className="mb-4 rounded-2xl bg-bad-soft border border-bad/25 px-5 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      {loading ? (
        <Card><div className="p-8 text-sm text-faint">Loading…</div></Card>
      ) : session ? (
        <LiveSession session={session} checkins={checkins} refresh={refresh} />
      ) : canEdit ? (
        <StartSession todayISO={todayISO} onCreated={refresh} />
      ) : (
        <Card className="mb-5">
          <div className="p-8 text-sm text-muted text-center">
            No practice session is open today — an editor starts one when practice is on.
          </div>
        </Card>
      )}

      {canEdit && <ZeffyFines />}
      <Ledger />
      <History todayISO={todayISO} />

      {payModal && <PaymentModal onClose={() => { setPayModal(false) }} />}
    </div>
  )
}

// ---- create today's session ----

function StartSession({ todayISO, onCreated }) {
  const [form, setForm] = useState({
    cutoff_min: 19 * 60,
    grace_min: 5,
    tier1_until_min: 30,
    tier1_amount: 5,
    tier2_amount: 10,
    fines_active: true,
    password: genPassword(),
  })
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    const { password, ...sessionFields } = form
    // Session row (team-readable) and its password (editor-only) are stored
    // separately so members can't read today's code from the API.
    const { data: sess, error } = await supabase
      .from('attendance_sessions')
      .insert({ session_date: todayISO, ...sessionFields })
      .select('id')
      .single()
    if (!error && sess) {
      const { error: e2 } = await supabase
        .from('session_secrets')
        .insert({ session_id: sess.id, password })
      if (e2) { setBusy(false); alert('Could not save the password: ' + e2.message); return }
    }
    setBusy(false)
    if (error) {
      console.error(error)
      alert('Could not create the session: ' + error.message)
      return
    }
    onCreated()
  }

  return (
    <Card className="mb-5">
      <CardHeader
        title={`Start today's practice — ${fmtDate(todayISO, { weekday: 'long', month: 'short', day: 'numeric' })}`}
        subtitle="Creates the check-in session and today's password. Share the QR/link once it's live."
      />
      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Field label="On-time cutoff">
            <Select
              value={form.cutoff_min}
              onChange={(e) => setForm({ ...form, cutoff_min: Number(e.target.value) })}
            >
              {timeOpts.map((m) => <option key={m} value={m}>{minToLabel(m)}</option>)}
            </Select>
          </Field>
          <Field label="Grace (no fine), min">
            <input
              type="number" min="0" className={inputCls} value={form.grace_min}
              onChange={(e) => setForm({ ...form, grace_min: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label={`${money(form.tier1_amount)} fine until, min`}>
            <input
              type="number" min="0" className={inputCls} value={form.tier1_until_min}
              onChange={(e) => setForm({ ...form, tier1_until_min: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Then flat fine">
            <input
              type="number" min="0" className={inputCls} value={form.tier2_amount}
              onChange={(e) => setForm({ ...form, tier2_amount: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
        <p className="text-xs text-muted mb-4">
          With these settings: free until {minToLabel(form.cutoff_min + form.grace_min)}, {money(form.tier1_amount)} until{' '}
          {minToLabel(form.cutoff_min + form.tier1_until_min)}, {money(form.tier2_amount)} after that.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input
              type="checkbox" checked={form.fines_active}
              onChange={(e) => setForm({ ...form, fines_active: e.target.checked })}
            />
            Fines active today
          </label>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-muted">Password:</span>
            <code className="px-2.5 py-1 bg-subtle rounded-lg text-sm font-bold tracking-wide">{form.password}</code>
            <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, password: genPassword() })}>↻ New</Button>
          </div>
          <Button variant="primary" disabled={busy} onClick={create}>
            {busy ? 'Starting…' : 'Start session'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ---- live session dashboard ----

function LiveSession({ session, checkins, refresh }) {
  const { state } = useStore()
  const { canEdit } = useAuth()
  const [qr, setQr] = useState(null)
  const url = checkInURL()

  useEffect(() => {
    QRCode.toDataURL(url, { width: 480, margin: 1 }).then(setQr).catch(console.error)
  }, [url])

  const checkedIds = new Set(checkins.map((c) => c.member_id))
  const activeRoster = state.roster.filter(isActive)
  const missing = activeRoster.filter((m) => !checkedIds.has(m.id))

  const ended = !!session.ended_at

  const setFines = async (on) => {
    await supabase.from('attendance_sessions').update({ fines_active: on }).eq('id', session.id)
    refresh()
  }

  // End = close check-in, keep everything. Fines recorded so far stand.
  const endSession = async () => {
    if (!confirm('End today\'s check-in? Fines recorded so far stand, and nobody else can check in. (You can reopen if needed.)')) return
    const { error } = await supabase
      .from('attendance_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', session.id)
    if (error) { alert('Could not end the session: ' + error.message); return }
    refresh()
  }

  const reopenSession = async () => {
    await supabase.from('attendance_sessions').update({ ended_at: null }).eq('id', session.id)
    refresh()
  }

  const deleteSession = async () => {
    if (!confirm('Delete today\'s session ENTIRELY? All of today\'s check-ins and fines go with it. To just close check-in, use End session instead.')) return
    await supabase.from('attendance_sessions').delete().eq('id', session.id)
    refresh()
  }

  const removeCheckin = async (c) => {
    if (!confirm(`Remove ${c.member_name}'s check-in? They can check in again.`)) return
    await supabase.from('checkins').delete().eq('id', c.id)
    refresh()
  }

  const totalFines = checkins.reduce((n, c) => n + Number(c.fine), 0)

  // Editors can adjust a fine without touching the check-in (waive = 0).
  const editFine = async (c) => {
    const input = prompt(`Fine for ${c.member_name} (0 waives it):`, Number(c.fine).toFixed(2))
    if (input === null) return
    const fine = Number(input)
    if (Number.isNaN(fine) || fine < 0) return alert('Enter a valid amount.')
    const { error } = await supabase.from('checkins').update({ fine }).eq('id', c.id)
    if (error) alert('Could not update: ' + error.message)
    refresh()
  }

  // Manual entry for phones that died / unlinked accounts.
  const manualCheckIn = async () => {
    const options = missing.map((m, i) => `${i + 1}. ${m.name}`).join('\n')
    const pick = prompt(`Manually check in — enter a number:\n${options}`)
    if (pick === null) return
    const member = missing[Number(pick) - 1]
    if (!member) return alert('No member matched that number.')
    const now = new Date()
    const nowMin = now.getHours() * 60 + now.getMinutes()
    let fine = 0
    if (session.fines_active && nowMin > session.cutoff_min + session.grace_min) {
      fine = nowMin <= session.cutoff_min + session.tier1_until_min
        ? Number(session.tier1_amount) : Number(session.tier2_amount)
    }
    const input = prompt(`Fine for ${member.name} (computed from current time):`, fine.toFixed(2))
    if (input === null) return
    const finalFine = Number(input)
    if (Number.isNaN(finalFine) || finalFine < 0) return alert('Enter a valid amount.')
    const { error } = await supabase.from('checkins').insert({
      session_id: session.id, member_id: member.id, member_name: member.name,
      mins_late: Math.max(0, nowMin - session.cutoff_min), fine: finalFine, no_show: false,
    })
    if (error) alert('Could not check them in: ' + error.message)
    refresh()
  }

  // No-show review (after ending): fine or excuse, both keep a record.
  const recordNoShow = async (member, fine) => {
    const { error } = await supabase.from('checkins').insert({
      session_id: session.id, member_id: member.id, member_name: member.name,
      mins_late: 0, fine, no_show: true,
    })
    if (error) alert('Could not record: ' + error.message)
    refresh()
  }
  const fineNoShow = async (member) => {
    const input = prompt(`No-show fine for ${member.name}:`, Number(session.tier2_amount).toFixed(2))
    if (input === null) return
    const fine = Number(input)
    if (Number.isNaN(fine) || fine < 0) return alert('Enter a valid amount.')
    recordNoShow(member, fine)
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5 items-start">
      {/* Share card */}
      <Card>
        <CardHeader title="Today's check-in" subtitle={fmtDate(session.session_date, { weekday: 'long', month: 'short', day: 'numeric' })} />
        <div className="px-5 pb-5 flex flex-col items-center text-center">
          {ended ? (
            <>
              <p className="text-4xl mt-4 mb-2">🏁</p>
              <p className="font-semibold text-ink">Check-in closed</p>
              <p className="text-xs text-muted mb-4">
                ended at {fmtTeamTime(session.ended_at)} — fines recorded today stand
              </p>
              {canEdit && (
                <Button size="sm" onClick={reopenSession}>Reopen check-in</Button>
              )}
            </>
          ) : (
            <>
              {qr && <img src={qr} alt="Check-in QR code" className="w-48 h-48 rounded-xl border border-line" />}
              <div className="mt-3 text-2xl font-black tracking-widest text-ink uppercase">{session.password}</div>
              <p className="text-[11px] text-faint mb-3">announce this at practice — it changes daily</p>
              <div className="flex gap-2 flex-wrap justify-center">
                <Button size="sm" onClick={() => navigator.clipboard.writeText(url)}>Copy link</Button>
                <Button size="sm" variant="ghost" onClick={() => window.open(url, '_blank')}>Open page</Button>
                {canEdit && <Button size="sm" variant="primary" onClick={endSession}>🏁 End session</Button>}
              </div>
            </>
          )}
          <div className="mt-4 w-full border-t border-line pt-3 flex items-center justify-between">
            <label className={`flex items-center gap-2 text-sm text-ink ${canEdit ? 'cursor-pointer' : ''}`}>
              <input type="checkbox" disabled={!canEdit || ended} checked={session.fines_active} onChange={(e) => setFines(e.target.checked)} />
              Fines active
            </label>
            {canEdit && <Button size="sm" variant="ghost" className="text-bad" onClick={deleteSession}>Delete session</Button>}
          </div>
          <p className="text-[11px] text-faint mt-2 self-start text-left">
            Cutoff {minToLabel(session.cutoff_min)} · free until {minToLabel(session.cutoff_min + session.grace_min)} ·{' '}
            {money(session.tier1_amount)} until {minToLabel(session.cutoff_min + session.tier1_until_min)} · then {money(session.tier2_amount)}
          </p>
        </div>
      </Card>

      {/* Check-ins */}
      <Card className="xl:col-span-2">
        <CardHeader
          title={`Checked in (${checkins.filter((c) => !c.no_show).length}/${activeRoster.length})`}
          subtitle={totalFines > 0 ? `${money(totalFines)} in fines so far today` : 'No fines so far today'}
          actions={
            <div className="flex gap-2">
              {canEdit && !ended && missing.length > 0 && (
                <Button size="sm" onClick={manualCheckIn}>+ Manual check-in</Button>
              )}
              <Button size="sm" variant="ghost" onClick={refresh}>↻ Refresh</Button>
            </div>
          }
        />
        <div className="px-5 pb-5">
          {checkins.length === 0 ? (
            <p className="text-sm text-faint italic mb-4">Nobody has checked in yet.</p>
          ) : (
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="pb-2 pr-3 font-medium">Member</th>
                  <th className="pb-2 pr-3 font-medium">Time</th>
                  <th className="pb-2 pr-3 font-medium">Late</th>
                  <th className="pb-2 pr-3 font-medium">Fine</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {checkins.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3 font-medium text-ink">{c.member_name}</td>
                    <td className="py-2 pr-3 text-muted">{c.no_show ? '—' : fmtTeamTime(c.checked_at)}</td>
                    <td className="py-2 pr-3">
                      {c.no_show
                        ? (Number(c.fine) > 0
                            ? <Badge className="bg-bad-soft text-bad">no-show</Badge>
                            : <Badge className="bg-subtle text-muted">no-show · excused</Badge>)
                        : c.mins_late > 0
                          ? <Badge className="bg-warn-soft text-warn">{c.mins_late} min</Badge>
                          : <Badge className="bg-good-soft text-good">on time</Badge>}
                    </td>
                    <td className="py-2 pr-3 font-semibold text-ink whitespace-nowrap">
                      {Number(c.fine) > 0 ? <span className="text-bad">{money(c.fine)}</span> : '—'}
                      {canEdit && (
                        <button
                          className="ml-1.5 text-faint hover:text-muted cursor-pointer text-xs"
                          title="Adjust or waive this fine (keeps the check-in)"
                          onClick={() => editFine(c)}
                        >✎</button>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {canEdit && (
                        <button
                          className="text-faint hover:text-bad cursor-pointer text-xs"
                          title="Remove check-in"
                          onClick={() => removeCheckin(c)}
                        >✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {missing.length > 0 && !ended && (
            <>
              <p className="text-[11px] uppercase tracking-wide text-faint font-medium mb-1.5">
                Not checked in ({missing.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {missing.map((m) => (
                  <Badge key={m.id} className="bg-subtle text-muted">{m.name}</Badge>
                ))}
              </div>
            </>
          )}
          {missing.length > 0 && ended && canEdit && (
            <>
              <p className="text-[11px] uppercase tracking-wide text-warn font-medium mb-1.5">
                ⚠ No-shows to review ({missing.length}) — fine or excuse each
              </p>
              <ul className="divide-y divide-line">
                {missing.map((m) => (
                  <li key={m.id} className="py-1.5 flex items-center gap-2 text-sm">
                    <span className="flex-1 font-medium text-ink">{m.name}</span>
                    <Button size="sm" variant="danger" onClick={() => fineNoShow(m)}>Fine</Button>
                    <Button size="sm" variant="ghost" onClick={() => recordNoShow(m, 0)}>Excuse</Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {missing.length > 0 && ended && !canEdit && (
            <p className="text-xs text-faint">{missing.length} member{missing.length > 1 ? 's' : ''} didn't check in.</p>
          )}
        </div>
      </Card>
    </div>
  )
}

// ---- Zeffy fine payments awaiting confirmation ----
// Zeffy payments that look like fine payments and haven't been recorded yet.
// Editors confirm each one; external_id keeps them from double-counting.

function ZeffyFines() {
  const { state } = useStore()
  const [candidates, setCandidates] = useState([])
  const [picks, setPicks] = useState({}) // zeffy id -> memberId

  const load = async () => {
    const [{ data: zeffy }, { data: recorded }] = await Promise.all([
      supabase.from('zeffy_payments').select('*').eq('status', 'succeeded'),
      supabase.from('payments').select('external_id').not('external_id', 'is', null),
    ])
    if (!zeffy) return
    const seen = new Set((recorded ?? []).map((r) => r.external_id))
    const fines = zeffy.filter(
      (p) => !seen.has(p.id) && JSON.stringify(p.raw ?? '').toLowerCase().includes('fine'),
    )
    setCandidates(fines)
    // Prefill using the shared matcher (full name, then unique last name).
    const match = buildMatcher(state.roster, state.dues.contactLinks)
    const prefill = {}
    for (const p of fines) {
      const memberId = match(p)
      if (memberId) prefill[p.id] = memberId
    }
    setPicks(prefill)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roster])

  const record = async (p) => {
    const member = state.roster.find((m) => m.id === picks[p.id])
    if (!member) return
    const { error } = await supabase.from('payments').insert({
      member_id: member.id,
      member_name: member.name,
      amount: p.amount_cents / 100,
      source: 'zeffy',
      external_id: p.id,
      note: p.description || 'Zeffy fine payment',
    })
    if (error) alert('Could not record: ' + error.message)
    load()
  }

  if (candidates.length === 0) return null

  return (
    <Card className="mb-5">
      <CardHeader
        title={`Zeffy fine payments to confirm (${candidates.length})`}
        subtitle='Payments from Zeffy mentioning "fine" that aren&apos;t in the ledger yet. Confirm who each one belongs to.'
      />
      <ul className="px-5 pb-5 divide-y divide-line">
        {candidates.map((p) => (
          <li key={p.id} className="py-2 flex items-center gap-3 text-sm flex-wrap">
            <span className="font-medium text-ink">
              {`${p.buyer_first ?? ''} ${p.buyer_last ?? ''}`.trim() || p.buyer_email || 'Unknown'}
            </span>
            <Badge className="bg-subtle text-muted">{money(p.amount_cents / 100)}</Badge>
            <span className="text-xs text-faint">
              {new Date(p.created).toLocaleDateString()} · {p.description || 'no campaign'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Select
                className="!w-44 !py-1.5"
                value={picks[p.id] ?? ''}
                onChange={(e) => setPicks({ ...picks, [p.id]: e.target.value })}
              >
                <option value="">Who is this?</option>
                {state.roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <Button size="sm" variant="success" disabled={!picks[p.id]} onClick={() => record(p)}>
                Record
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ---- all-time fines ledger ----

function Ledger() {
  const { state } = useStore()
  const [rows, setRows] = useState(null)

  useEffect(() => {
    ;(async () => {
      const [{ data: fines }, { data: pays }] = await Promise.all([
        supabase.from('checkins').select('member_id, member_name, fine, no_show'),
        supabase.from('payments').select('member_id, amount'),
      ])
      if (!fines) return
      const acc = {}
      const bump = (id, name) => (acc[id] = acc[id] || { id, name, attended: 0, fined: 0, paid: 0 })
      for (const c of fines) {
        const r = bump(c.member_id, c.member_name)
        if (!c.no_show) r.attended += 1
        r.fined += Number(c.fine)
        r.name = c.member_name
      }
      for (const p of pays || []) {
        if (!p.member_id) continue
        bump(p.member_id, '').paid += Number(p.amount)
      }
      // pick up roster names for payment-only rows
      for (const r of Object.values(acc)) {
        if (!r.name) r.name = state.roster.find((m) => m.id === r.id)?.name ?? 'Unknown'
      }
      setRows(Object.values(acc).sort((a, b) => (b.fined - b.paid) - (a.fined - a.paid)))
    })()
  }, [state.roster])

  if (!rows || rows.length === 0) return null

  return (
    <Card className="mb-5">
      <CardHeader title="Fines ledger" subtitle="All-time totals — never resets. Payments come off the outstanding balance." />
      <div className="px-5 pb-5 overflow-x-auto thin-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="pb-2 pr-3 font-medium">Member</th>
              <th className="pb-2 pr-3 font-medium">Practices</th>
              <th className="pb-2 pr-3 font-medium">Total fined</th>
              <th className="pb-2 pr-3 font-medium">Paid</th>
              <th className="pb-2 font-medium">Outstanding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const due = r.fined - r.paid
              return (
                <tr key={r.id}>
                  <td className="py-2 pr-3 font-medium text-ink">{r.name}</td>
                  <td className="py-2 pr-3 text-muted">{r.attended}</td>
                  <td className="py-2 pr-3 text-muted">{money(r.fined)}</td>
                  <td className="py-2 pr-3 text-muted">{money(r.paid)}</td>
                  <td className="py-2">
                    {due > 0
                      ? <Badge className="bg-bad-soft text-bad">{money(due)} due</Badge>
                      : <Badge className="bg-good-soft text-good">settled</Badge>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ---- past sessions ----

function History({ todayISO }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    ;(async () => {
      const { data: sessions } = await supabase
        .from('attendance_sessions')
        .select('id, session_date, checkins(fine)')
        .lt('session_date', todayISO)
        .order('session_date', { ascending: false })
        .limit(20)
      if (sessions) setRows(sessions)
    })()
  }, [todayISO])

  if (!rows || rows.length === 0) return null

  return (
    <Card>
      <CardHeader title="Past practices" />
      <ul className="px-5 pb-5 divide-y divide-line">
        {rows.map((s) => {
          const fines = s.checkins.reduce((n, c) => n + Number(c.fine), 0)
          return (
            <li key={s.id} className="py-2 flex items-center justify-between text-sm">
              <span className="font-medium text-ink">
                {fmtDate(s.session_date, { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <span className="text-muted">
                {s.checkins.length} checked in{fines > 0 ? ` · ${money(fines)} fines` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// ---- manual payment ----

function PaymentModal({ onClose }) {
  const { state } = useStore()
  const [memberId, setMemberId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const member = state.roster.find((m) => m.id === memberId)
    if (!member || !Number(amount)) return
    setBusy(true)
    const { error } = await supabase.from('payments').insert({
      member_id: member.id,
      member_name: member.name,
      amount: Number(amount),
      source: 'manual',
      note: note || null,
    })
    setBusy(false)
    if (error) {
      alert('Could not record the payment: ' + error.message)
      return
    }
    onClose()
  }

  return (
    <Modal title="Record a fine payment" onClose={onClose}>
      <Field label="Member">
        <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">— select —</option>
          {state.roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </Field>
      <Field label="Amount ($)">
        <input type="number" min="0" step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Note (optional)">
        <TextInput placeholder="e.g. paid via Zeffy 7/13" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-[11px] text-faint mb-3">
        Zeffy payments will reconcile automatically once the webhook is connected — this is for cash/manual cases.
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !memberId || !Number(amount)} onClick={save}>
          {busy ? 'Saving…' : 'Record payment'}
        </Button>
      </div>
    </Modal>
  )
}
