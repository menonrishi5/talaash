import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase, SUPABASE_URL } from '../supabase.js'
import WeekGrid from './WeekGrid.jsx'
import {
  uid, weekStartISO, addDaysISO, fmtWeekRange, minToLabel, durationLabel,
  DAY_NAMES, parseBenchingSheet, toISODate,
} from '../lib.js'
import { isActive } from '../matching.js'
import { Button, Card, CardHeader, Modal, Field, Select, TextInput, Badge, EmptyState, inputCls } from './ui.jsx'

const STATUS_META = {
  pending: { label: 'Awaiting confirmation', color: '#a1a1aa', badge: 'bg-zinc-100 text-zinc-600' },
  primary: { label: 'Confirmed', color: '#10b981', badge: 'bg-emerald-100 text-emerald-700' },
  reserve: { label: 'Reserve covering', color: '#0ea5e9', badge: 'bg-sky-100 text-sky-700' },
  cover: { label: 'Manual cover', color: '#8b5cf6', badge: 'bg-violet-100 text-violet-700' },
  uncovered: { label: 'NOT COVERED', color: '#ef4444', badge: 'bg-red-100 text-red-700' },
}

export default function Benching() {
  const { state } = useStore()
  const { canEdit, memberId } = useAuth()
  const { benching } = state
  const [weekISO, setWeekISO] = useState(weekStartISO())
  const [importOpen, setImportOpen] = useState(false)
  const [slotModal, setSlotModal] = useState(null) // template slot id or 'new'
  const [statsOpen, setStatsOpen] = useState(false)
  const [locOpen, setLocOpen] = useState(false)
  const [responses, setResponses] = useState([])

  const loadResponses = async () => {
    const { data } = await supabase.from('slot_responses').select('*')
    if (data) setResponses(data)
  }
  useEffect(() => {
    loadResponses()
  }, [])

  const overrides = benching.weeks[weekISO] || {}
  const memberName = (id) => state.roster.find((m) => m.id === id)?.name ?? '—'

  const slotStatus = (slot) => overrides[slot.id]?.status ?? 'pending'

  const events = benching.template.map((slot) => {
    const status = slotStatus(slot)
    const ov = overrides[slot.id]
    const meta = STATUS_META[status]
    const who =
      status === 'reserve' ? memberName(slot.reserveId)
      : status === 'cover' ? memberName(ov?.coverMemberId)
      : memberName(slot.memberId)
    return {
      id: slot.id,
      day: slot.day,
      startMin: slot.startMin,
      endMin: slot.endMin,
      color: meta.color,
      dashed: status === 'pending',
      title: status === 'uncovered' ? '⚠ Uncovered' : who,
      subtitle:
        status === 'pending' ? `${memberName(slot.memberId)}${slot.reserveId ? ` · res: ${memberName(slot.reserveId)}` : ''}`
        : status === 'reserve' ? 'reserve'
        : status === 'cover' ? 'covering'
        : status === 'uncovered' ? who
        : null,
      onClick: () => setSlotModal(slot.id),
    }
  })

  const uncovered = benching.template.filter((s) => slotStatus(s) === 'uncovered')

  const now = new Date()
  const todayISO = toISODate(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const pastPending = benching.template.filter((s) => {
    if (slotStatus(s) !== 'pending') return false
    const date = addDaysISO(weekISO, s.day)
    return date < todayISO || (date === todayISO && s.endMin <= nowMin)
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 mb-1">Benching</h1>
          <p className="text-sm text-zinc-500">Room reservations — who's holding the space, and when.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setStatsOpen(true)}>Hour tracker</Button>
          {canEdit && (
            <>
              <Button size="sm" onClick={() => setImportOpen(true)}>Import sheet</Button>
              <Button size="sm" variant="primary" onClick={() => setSlotModal('new')}>+ Add slot</Button>
            </>
          )}
        </div>
      </div>

      {memberId && (
        <MyBenching responses={responses} onChanged={loadResponses} />
      )}

      <CalendarSubscribe />

      {/* Location */}
      <Card className="mb-5">
        <div className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-zinc-500">Practice location:</span>
          {benching.locations.length === 0 ? (
            <span className="text-sm text-zinc-400 italic">none yet</span>
          ) : (
            <LocationSelect />
          )}
          {canEdit && <Button size="sm" variant="ghost" onClick={() => setLocOpen(true)}>Manage locations</Button>}
          {benching.activeLocation && (
            <Badge className="bg-zinc-900 text-white ml-auto">📍 {benching.activeLocation}</Badge>
          )}
        </div>
      </Card>

      {/* Warning banners */}
      {uncovered.length > 0 && (
        <div className="mb-4 rounded-2xl bg-red-50 border border-red-200 px-5 py-3.5">
          <p className="text-sm font-semibold text-red-700 mb-1">
            ⚠ {uncovered.length} slot{uncovered.length > 1 ? 's' : ''} not covered this week
          </p>
          <ul className="text-xs text-red-600 space-y-0.5">
            {uncovered.map((s) => (
              <li key={s.id}>
                {DAY_NAMES[s.day]} {minToLabel(s.startMin)} – {minToLabel(s.endMin)} (was {memberName(s.memberId)}) —{' '}
                <button className="underline cursor-pointer" onClick={() => setSlotModal(s.id)}>assign cover</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(() => {
        const inactiveSlots = benching.template.filter((s) => {
          const m = state.roster.find((r) => r.id === s.memberId)
          const res = state.roster.find((r) => r.id === s.reserveId)
          return (m && !isActive(m)) || (res && !isActive(res))
        })
        return inactiveSlots.length > 0 ? (
          <div className="mb-4 rounded-2xl bg-amber-50 border border-amber-200 px-5 py-3">
            <p className="text-xs text-amber-800">
              <span className="font-semibold">{inactiveSlots.length} slot{inactiveSlots.length > 1 ? 's' : ''} assigned to an inactive member</span> — {' '}
              {inactiveSlots.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ', '}
                  <button className="underline cursor-pointer" onClick={() => setSlotModal(s.id)}>
                    {DAY_NAMES[s.day]} {minToLabel(s.startMin)}
                  </button>
                </span>
              ))}
              . Reassign when you get a chance.
            </p>
          </div>
        ) : null
      })()}

      {pastPending.length > 0 && (
        <div className="mb-4 rounded-2xl bg-amber-50 border border-amber-200 px-5 py-3">
          <p className="text-xs text-amber-800">
            <span className="font-semibold">{pastPending.length} past slot{pastPending.length > 1 ? 's' : ''} unconfirmed</span> — confirm attendance so hours count toward the requirement.
          </p>
        </div>
      )}

      {/* Week grid */}
      <Card className="mb-5">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 flex-wrap">
            {Object.entries(STATUS_META).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1 mr-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: v.color }} />
                {v.label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={() => setWeekISO(addDaysISO(weekISO, -7))}>‹</Button>
            <Button size="sm" onClick={() => setWeekISO(weekStartISO())}>Today</Button>
            <Button size="sm" onClick={() => setWeekISO(addDaysISO(weekISO, 7))}>›</Button>
            <span className="text-sm font-semibold text-zinc-700 w-36 text-right">{fmtWeekRange(weekISO)}</span>
          </div>
        </div>
        {benching.template.length === 0 ? (
          <EmptyState
            icon={<span className="text-lg">🪑</span>}
            title="No benching schedule yet"
            hint={canEdit
              ? 'Import your sheet (Day, Start, End, Member, Reserve) or add slots manually. The schedule repeats weekly.'
              : 'An editor can import the weekly benching sheet here.'}
            action={canEdit ? (
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => setImportOpen(true)}>Import sheet</Button>
                <Button onClick={() => setSlotModal('new')}>Add a slot</Button>
              </div>
            ) : null}
          />
        ) : (
          <div className="p-3">
            <WeekGrid weekISO={weekISO} events={events} />
          </div>
        )}
      </Card>

      {canEdit && <NotificationSettings />}

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
      {locOpen && <LocationsModal onClose={() => setLocOpen(false)} />}
      {statsOpen && <StatsModal onClose={() => setStatsOpen(false)} />}
      {slotModal && (
        <SlotModal
          slotId={slotModal === 'new' ? null : slotModal}
          weekISO={weekISO}
          response={responses.find((r) => r.week_iso === weekISO && r.slot_id === slotModal) ?? null}
          onClose={() => setSlotModal(null)}
        />
      )}
    </div>
  )
}

// The signed-in member's own upcoming slots (this week + next), with
// accept / decline. Responses drive the Slack reminders and the automatic
// reserve call-up at the deadline.
function MyBenching({ responses, onChanged }) {
  const { state } = useStore()
  const { memberId } = useAuth()
  const { benching, settings, roster } = state
  const deadlineH = settings?.benchingAcceptDeadlineHours ?? 12
  const [busy, setBusy] = useState(null) // occurrence key while saving

  const nameOf = (id) => roster.find((m) => m.id === id)?.name ?? '—'
  const now = new Date()

  const occurrences = []
  for (const wkISO of [weekStartISO(), addDaysISO(weekStartISO(), 7)]) {
    for (const slot of benching.template) {
      if (slot.memberId !== memberId && slot.reserveId !== memberId) continue
      const dateISO = addDaysISO(wkISO, slot.day)
      const [y, mo, d] = dateISO.split('-').map(Number)
      const start = new Date(y, mo - 1, d, Math.floor(slot.startMin / 60), slot.startMin % 60)
      const end = new Date(y, mo - 1, d, Math.floor(slot.endMin / 60), slot.endMin % 60)
      if (end < now) continue
      const resp = responses.find((r) => r.week_iso === wkISO && r.slot_id === slot.id) ?? null
      const pastDeadline = now.getTime() > start.getTime() - deadlineH * 3600000
      const reserveOn = resp?.status === 'declined' || (resp?.status !== 'accepted' && pastDeadline && slot.reserveId)
      occurrences.push({ wkISO, slot, dateISO, start, resp, pastDeadline, reserveOn, mine: slot.memberId === memberId })
    }
  }
  occurrences.sort((a, b) => a.start - b.start)

  if (occurrences.length === 0) return null

  const respond = async (occ, status) => {
    const key = `${occ.wkISO}:${occ.slot.id}`
    setBusy(key)
    const { error } = await supabase.from('slot_responses').upsert(
      { week_iso: occ.wkISO, slot_id: occ.slot.id, member_id: occ.slot.memberId, status },
      { onConflict: 'week_iso,slot_id' },
    )
    setBusy(null)
    if (error) alert('Could not save: ' + error.message)
    else onChanged()
  }

  return (
    <Card className="mb-5">
      <CardHeader
        title="My benching"
        subtitle={`Accept your slots so the room's covered — unaccepted slots pass to the reserve ${deadlineH}h before start.`}
      />
      <ul className="px-5 pb-5 divide-y divide-zinc-100">
        {occurrences.map((occ) => {
          const key = `${occ.wkISO}:${occ.slot.id}`
          return (
            <li key={key} className="py-2.5 flex items-center gap-3 flex-wrap text-sm">
              <div className="flex-1 min-w-44">
                <span className="font-medium text-zinc-800">
                  {DAY_NAMES[occ.slot.day]} {occ.dateISO.slice(5)} · {minToLabel(occ.slot.startMin)} – {minToLabel(occ.slot.endMin)}
                </span>
                {!occ.mine && (
                  <span className="block text-xs text-zinc-400">
                    you're the reserve for {nameOf(occ.slot.memberId)}
                  </span>
                )}
              </div>

              {occ.mine ? (
                occ.resp?.status === 'accepted' ? (
                  <>
                    <Badge className="bg-emerald-100 text-emerald-700">✓ accepted</Badge>
                    <Button size="sm" variant="ghost" className="text-red-500" disabled={busy === key}
                      onClick={() => respond(occ, 'declined')}>
                      Can't make it anymore
                    </Button>
                  </>
                ) : occ.resp?.status === 'declined' ? (
                  <Badge className="bg-zinc-100 text-zinc-600">
                    declined{occ.slot.reserveId ? ` — passed to ${nameOf(occ.slot.reserveId)}` : ''}
                  </Badge>
                ) : occ.reserveOn ? (
                  <Badge className="bg-amber-100 text-amber-800">
                    deadline passed — {occ.slot.reserveId ? `${nameOf(occ.slot.reserveId)} called` : 'uncovered'}
                  </Badge>
                ) : (
                  <>
                    <Button size="sm" variant="success" disabled={busy === key} onClick={() => respond(occ, 'accepted')}>
                      ✓ Accept
                    </Button>
                    <Button size="sm" variant="danger" disabled={busy === key} onClick={() => respond(occ, 'declined')}>
                      Can't make it
                    </Button>
                  </>
                )
              ) : occ.reserveOn ? (
                <Badge className="bg-sky-100 text-sky-700">🔁 you're up — please cover this</Badge>
              ) : (
                <Badge className="bg-zinc-100 text-zinc-500">
                  on standby{occ.resp?.status === 'accepted' ? ` — ${nameOf(occ.slot.memberId)} accepted` : ''}
                </Badge>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// Personal calendar subscription — practice blocks + this member's benching
// slots, as a webcal feed for Google/Apple Calendar. Any signed-in member.
function CalendarSubscribe() {
  const { session } = useAuth()
  const [token, setToken] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!session) return
    supabase.rpc('my_calendar_token').then(({ data }) => setToken(data ?? null))
  }, [session])

  if (!token) return null
  const base = `${SUPABASE_URL}/functions/v1/calendar?token=${token}`
  const webcal = base.replace(/^https?:\/\//, 'webcal://')

  return (
    <Card className="mb-5">
      <CardHeader
        title="Subscribe to your calendar"
        subtitle="Practices and your benching slots, auto-updating in Google or Apple Calendar."
      />
      <div className="px-5 pb-5 flex items-center gap-2 flex-wrap">
        <code className="flex-1 min-w-64 text-xs bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 truncate" title={base}>
          {base}
        </code>
        <Button size="sm" onClick={() => { navigator.clipboard.writeText(base); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
        <Button size="sm" variant="primary" onClick={() => window.open(webcal, '_blank')}>Add to calendar</Button>
      </div>
      <p className="px-5 pb-4 -mt-2 text-[11px] text-zinc-400">
        This link is personal to you — don't share it. In Google Calendar use “Other calendars → From URL”.
      </p>
    </Card>
  )
}

// Editor-only: weekly digest channel + a log of Slack notifications that
// couldn't be delivered (usually an app email that doesn't match Slack).
function NotificationSettings() {
  const { state, setSettings } = useStore()
  const [channel, setChannel] = useState(state.settings?.slackDigestChannel ?? '')
  const [misses, setMisses] = useState([])

  useEffect(() => {
    supabase
      .from('notification_log')
      .select('*')
      .neq('detail', 'sent')
      .order('sent_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setMisses(data ?? []))
  }, [])

  return (
    <Card className="mb-5">
      <CardHeader
        title="Notifications"
        subtitle="Slack reminders for benching. Set the channel for the Monday digest; check below for anyone the bot couldn't reach."
      />
      <div className="px-5 pb-5">
        <div className="flex items-end gap-2 mb-4 flex-wrap">
          <label className="flex-1 min-w-56">
            <span className="block text-xs font-medium text-zinc-500 mb-1">Weekly digest Slack channel ID</span>
            <input
              className={inputCls}
              placeholder="e.g. C0123ABCD (invite the bot to it first)"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            />
          </label>
          <Button variant="primary" onClick={() => setSettings({ slackDigestChannel: channel.trim() })}>Save</Button>
        </div>
        {misses.length > 0 ? (
          <>
            <p className="text-[11px] uppercase tracking-wide text-zinc-400 font-medium mb-1.5">
              Recent undelivered notifications
            </p>
            <ul className="text-xs text-zinc-600 space-y-1">
              {misses.map((m) => (
                <li key={m.id} className="flex gap-2">
                  <span className="text-zinc-400">{new Date(m.sent_at).toLocaleDateString()}</span>
                  <span className="font-medium">{m.kind}</span>
                  <span className="text-red-600">{m.detail}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-zinc-400 mt-2">
              Usually means that member's app email doesn't match their Slack email, or their account isn't linked to a roster member.
            </p>
          </>
        ) : (
          <p className="text-xs text-zinc-400 italic">No delivery problems logged.</p>
        )}
      </div>
    </Card>
  )
}

function LocationSelect() {
  const { state, setBenching } = useStore()
  const { canEdit } = useAuth()
  return (
    <Select
      disabled={!canEdit}
      className="!w-56 disabled:bg-zinc-50"
      value={state.benching.activeLocation ?? ''}
      onChange={(e) => setBenching({ activeLocation: e.target.value || null })}
    >
      <option value="">— select —</option>
      {state.benching.locations.map((l) => (
        <option key={l} value={l}>{l}</option>
      ))}
    </Select>
  )
}

function LocationsModal({ onClose }) {
  const { state, addLocation, removeLocation } = useStore()
  const [name, setName] = useState('')
  const add = () => {
    const n = name.trim()
    if (n && !state.benching.locations.includes(n)) addLocation(n)
    setName('')
  }
  return (
    <Modal title="Practice locations" onClose={onClose}>
      <div className="flex gap-2 mb-3">
        <TextInput
          placeholder="e.g. Rec Center Studio B"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button variant="primary" onClick={add}>Add</Button>
      </div>
      <ul className="divide-y divide-zinc-100">
        {state.benching.locations.map((l) => (
          <li key={l} className="flex items-center justify-between py-2 text-sm">
            <span className="text-zinc-800">{l}</span>
            <Button size="sm" variant="ghost" className="text-red-500" onClick={() => removeLocation(l)}>Remove</Button>
          </li>
        ))}
        {state.benching.locations.length === 0 && (
          <li className="py-2 text-sm text-zinc-400 italic">No locations yet.</li>
        )}
      </ul>
    </Modal>
  )
}

function ImportModal({ onClose }) {
  const { ensureMembers, setTemplate } = useStore()
  const [text, setText] = useState('')
  const parsed = useMemo(() => parseBenchingSheet(text), [text])

  const doImport = () => {
    const names = new Set()
    parsed.rows.forEach((r) => {
      names.add(r.member)
      if (r.reserve) names.add(r.reserve)
    })
    const idByName = ensureMembers([...names])
    const slots = parsed.rows.map((r) => ({
      id: uid(),
      day: r.day,
      startMin: r.startMin,
      endMin: r.endMin,
      memberId: idByName[r.member.trim().toLowerCase()],
      reserveId: r.reserve ? idByName[r.reserve.trim().toLowerCase()] : null,
    }))
    setTemplate(slots)
    onClose()
  }

  return (
    <Modal title="Import benching sheet" onClose={onClose} wide>
      <p className="text-xs text-zinc-500 mb-2">
        Paste rows from your sheet — commas or straight from Google Sheets (tabs). One slot per line:{' '}
        <code className="bg-zinc-100 px-1 py-0.5 rounded">Day, Start, End, Member, Reserve</code>.
        The day carries down to following lines, so you can leave it off after the first row of each day.
        Times without AM/PM before 8 are treated as PM. New names are added to the roster automatically.
      </p>
      <textarea
        className={`${inputCls} h-48 font-mono !text-xs resize-y`}
        placeholder={'Thursday, 1:00, 2:30, Person A, Person E\n2:30, 4:00, Person B, Person E\nSunday, 12:00 PM, 1:30 PM, Person C, Person D'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-3 text-xs">
        {parsed.rows.length > 0 && (
          <p className="text-emerald-700 font-medium">✓ {parsed.rows.length} slot{parsed.rows.length > 1 ? 's' : ''} ready to import</p>
        )}
        {parsed.errors.map((e, i) => (
          <p key={i} className="text-red-600">✗ {e}</p>
        ))}
      </div>
      <div className="flex justify-between items-center mt-4">
        <p className="text-[11px] text-zinc-400 max-w-xs">
          Importing replaces the weekly template. Confirmed hours already earned are kept.
        </p>
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={parsed.rows.length === 0} onClick={doImport}>
            Import {parsed.rows.length || ''} slots
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Attendance + editing for one slot in a given week.
function SlotModal({ slotId, weekISO, response, onClose }) {
  const { state, setSlotStatus, addTemplateSlot, updateTemplateSlot, removeTemplateSlot } = useStore()
  const { canEdit } = useAuth()
  const slot = state.benching.template.find((s) => s.id === slotId) ?? null
  const isNew = !slot
  const ov = slot ? state.benching.weeks[weekISO]?.[slot.id] : null
  const status = ov?.status ?? 'pending'
  const memberName = (id) => state.roster.find((m) => m.id === id)?.name ?? '—'

  const [edit, setEdit] = useState(isNew)
  const [form, setForm] = useState({
    day: slot?.day ?? 0,
    startMin: slot?.startMin ?? 13 * 60,
    endMin: slot?.endMin ?? 14 * 60 + 30,
    memberId: slot?.memberId ?? '',
    reserveId: slot?.reserveId ?? '',
  })
  const [coverId, setCoverId] = useState('')

  const snapshot = slot
    ? { day: slot.day, startMin: slot.startMin, endMin: slot.endMin, memberId: slot.memberId, reserveId: slot.reserveId }
    : null

  const mark = (st, cover = null) => {
    setSlotStatus(weekISO, slot.id, st, cover, snapshot)
    onClose()
  }

  const saveEdit = () => {
    if (!form.memberId || form.endMin <= form.startMin) return
    const data = { ...form, reserveId: form.reserveId || null }
    if (isNew) addTemplateSlot(data)
    else updateTemplateSlot(slot.id, data)
    onClose()
  }

  const timeOpts = []
  for (let m = 8 * 60; m <= 24 * 60; m += 15) timeOpts.push(m)

  return (
    <Modal
      title={isNew ? 'Add benching slot' : `${DAY_NAMES[slot.day]} · ${minToLabel(slot.startMin)} – ${minToLabel(slot.endMin)}`}
      onClose={onClose}
    >
      {!isNew && !edit && (
        <>
          <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-3 mb-4 text-sm space-y-1">
            <p><span className="text-zinc-500">Assigned:</span> <span className="font-semibold text-zinc-800">{memberName(slot.memberId)}</span></p>
            <p><span className="text-zinc-500">Reserve:</span> <span className="font-medium text-zinc-700">{slot.reserveId ? memberName(slot.reserveId) : 'none'}</span></p>
            <p>
              <span className="text-zinc-500">This week ({fmtWeekRange(weekISO)}):</span>{' '}
              <Badge className={STATUS_META[status].badge}>{STATUS_META[status].label}</Badge>
              {status === 'cover' && <span className="ml-1 font-medium">{memberName(ov.coverMemberId)}</span>}
            </p>
            <p>
              <span className="text-zinc-500">Member response:</span>{' '}
              {response ? (
                <Badge className={response.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
                  {response.status}
                </Badge>
              ) : (
                <Badge className="bg-zinc-100 text-zinc-500">no response yet</Badge>
              )}
            </p>
          </div>

          {canEdit && (<>
          <p className="text-xs font-medium text-zinc-500 mb-2">Attendance for this week</p>
          <div className="space-y-2">
            <Button variant="success" className="w-full" onClick={() => mark('primary')}>
              ✓ {memberName(slot.memberId)} benched
            </Button>
            {slot.reserveId && (
              <Button className="w-full !border-sky-300 !text-sky-700 hover:!bg-sky-50" onClick={() => mark('reserve')}>
                ⇄ Can't make it — reserve {memberName(slot.reserveId)} benched
              </Button>
            )}
            <div className="flex gap-2">
              <Select value={coverId} onChange={(e) => setCoverId(e.target.value)}>
                <option value="">Neither — pick who covered…</option>
                {state.roster
                  .filter((m) => m.id !== slot.memberId && m.id !== slot.reserveId && isActive(m))
                  .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <Button disabled={!coverId} onClick={() => mark('cover', coverId)}>Confirm</Button>
            </div>
            <Button variant="danger" className="w-full" onClick={() => mark('uncovered')}>
              ⚠ Nobody can cover — flag as uncovered
            </Button>
            {status !== 'pending' && (
              <Button variant="ghost" className="w-full" onClick={() => mark(null)}>
                Reset to awaiting confirmation
              </Button>
            )}
          </div>

          <div className="flex justify-between mt-5 pt-3 border-t border-zinc-100">
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>Edit slot</Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500"
              onClick={() => {
                if (confirm('Delete this slot from the weekly template?')) {
                  removeTemplateSlot(slot.id)
                  onClose()
                }
              }}
            >
              Delete slot
            </Button>
          </div>
          </>)}
        </>
      )}

      {(isNew || edit) && (
        <>
          <Field label="Day">
            <Select value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}>
              {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <Select value={form.startMin} onChange={(e) => setForm({ ...form, startMin: Number(e.target.value) })}>
                {timeOpts.map((m) => <option key={m} value={m}>{minToLabel(m)}</option>)}
              </Select>
            </Field>
            <Field label="End">
              <Select value={form.endMin} onChange={(e) => setForm({ ...form, endMin: Number(e.target.value) })}>
                {timeOpts.filter((m) => m > form.startMin).map((m) => <option key={m} value={m}>{minToLabel(m)}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Member">
            <Select value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
              <option value="">— select —</option>
              {state.roster
                .filter((m) => isActive(m) || m.id === form.memberId)
                .map((m) => <option key={m.id} value={m.id}>{m.name}{!isActive(m) ? ' (inactive)' : ''}</option>)}
            </Select>
          </Field>
          <Field label="Reserve (backup)">
            <Select value={form.reserveId} onChange={(e) => setForm({ ...form, reserveId: e.target.value })}>
              <option value="">none</option>
              {state.roster
                .filter((m) => m.id !== form.memberId)
                .filter((m) => isActive(m) || m.id === form.reserveId)
                .map((m) => <option key={m.id} value={m.id}>{m.name}{!isActive(m) ? ' (inactive)' : ''}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 mt-2">
            <Button onClick={isNew ? onClose : () => setEdit(false)}>Cancel</Button>
            <Button variant="primary" disabled={!form.memberId} onClick={saveEdit}>
              {isNew ? 'Add slot' : 'Save changes'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

// Roster-wide benching hour totals across every confirmed week.
function StatsModal({ onClose }) {
  const { state, setBenching } = useStore()
  const { canEdit } = useAuth()
  const threshold = state.benching.threshold ?? 15

  const stats = useMemo(() => {
    const acc = {} // memberId -> {primary, reserve, cover} minutes
    const bump = (id, key, mins) => {
      if (!id) return
      acc[id] = acc[id] || { primary: 0, reserve: 0, cover: 0 }
      acc[id][key] += mins
    }
    for (const week of Object.values(state.benching.weeks)) {
      for (const ov of Object.values(week)) {
        if (!ov?.status || ov.startMin == null) continue
        const mins = ov.endMin - ov.startMin
        if (ov.status === 'primary') bump(ov.memberId, 'primary', mins)
        else if (ov.status === 'reserve') bump(ov.reserveId, 'reserve', mins)
        else if (ov.status === 'cover') bump(ov.coverMemberId, 'cover', mins)
      }
    }
    return acc
  }, [state.benching.weeks])

  const rows = state.roster
    .map((m) => {
      const s = stats[m.id] || { primary: 0, reserve: 0, cover: 0 }
      const total = s.primary + s.reserve + s.cover
      return { m, ...s, total }
    })
    .sort((a, b) => b.total - a.total)

  return (
    <Modal title="Benching hour tracker" onClose={onClose} wide>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-zinc-500">Requirement:</span>
        <input
          type="number"
          min="0"
          disabled={!canEdit}
          className="w-20 px-2 py-1 text-sm border border-zinc-300 rounded-lg disabled:bg-zinc-50"
          value={threshold}
          onChange={(e) => setBenching({ threshold: Number(e.target.value) || 0 })}
        />
        <span className="text-xs text-zinc-500">hours — all confirmed hours (normal, reserve, cover) count.</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400 italic">Roster is empty.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
              <th className="pb-2 pr-3 font-medium">Member</th>
              <th className="pb-2 pr-3 font-medium">Normal</th>
              <th className="pb-2 pr-3 font-medium">Reserve</th>
              <th className="pb-2 pr-3 font-medium">Cover</th>
              <th className="pb-2 pr-3 font-medium">Total</th>
              <th className="pb-2 font-medium">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map(({ m, primary, reserve, cover, total }) => {
              const pct = threshold > 0 ? Math.min((total / 60 / threshold) * 100, 100) : 100
              const met = total / 60 >= threshold
              return (
                <tr key={m.id}>
                  <td className="py-2 pr-3 font-medium text-zinc-800">{m.name}</td>
                  <td className="py-2 pr-3 text-zinc-600">{durationLabel(primary)}</td>
                  <td className="py-2 pr-3 text-zinc-600">{durationLabel(reserve)}</td>
                  <td className="py-2 pr-3 text-zinc-600">{durationLabel(cover)}</td>
                  <td className="py-2 pr-3 font-semibold text-zinc-800">{durationLabel(total)}</td>
                  <td className="py-2 w-40">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${met ? 'bg-emerald-500' : 'bg-zinc-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {met
                        ? <Badge className="bg-emerald-100 text-emerald-700">met</Badge>
                        : <span className="text-[11px] text-zinc-400 whitespace-nowrap">{Math.max(threshold - total / 60, 0).toFixed(1)}h left</span>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
