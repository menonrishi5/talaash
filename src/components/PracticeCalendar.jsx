import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase } from '../supabase.js'
import WeekGrid, { WeekAgenda, START_HOUR, END_HOUR } from './WeekGrid.jsx'
import {
  weekStartISO, addDaysISO, dayIndexOfISO, fmtWeekRange, fmtDate, relativeDays,
  segColor, minToLabel, durationLabel, DAY_NAMES, toISODate,
} from '../lib.js'
import { Button, Card, CardHeader, Modal, Field, Select, TextInput, Badge, PageHeader } from './ui.jsx'
import { MyAvailability, ConflictCheck, AutoSchedule, conflictsForBlock } from './Availability.jsx'
import { isActive } from '../matching.js'

function timeOptions(step = 15) {
  const opts = []
  for (let m = START_HOUR * 60; m <= END_HOUR * 60; m += step) opts.push(m)
  return opts
}
const TIME_OPTS = timeOptions()

export default function PracticeCalendar() {
  const { state, addPracticeBlock, updatePracticeBlock, removePracticeBlock } = useStore()
  const { canEdit } = useAuth()
  const [weekISO, setWeekISO] = useState(weekStartISO())
  const [draft, setDraft] = useState(null) // {id?, day, startMin, endMin, segmentId}
  const [avail, setAvail] = useState({}) // member_id|key -> busy[], for conflict overlay

  useEffect(() => {
    if (!canEdit) return
    supabase.from('member_availability').select('*').then(({ data }) => {
      const map = {}
      for (const r of data ?? []) map[`${r.member_id}|${r.key}`] = r.busy
      setAvail(map)
    })
  }, [canEdit])

  const segIndex = useMemo(
    () => Object.fromEntries(state.segments.map((s, i) => [s.id, i])),
    [state.segments],
  )

  // Active cast of a segment, for conflict checks.
  const castOf = (segId) =>
    (state.segments.find((s) => s.id === segId)?.members ?? [])
      .map((mm) => state.roster.find((r) => r.id === mm.memberId))
      .filter((m) => m && isActive(m))

  const weekBlocks = state.practiceBlocks.filter((b) => {
    const d = dayIndexOfISO(b.date)
    return addDaysISO(b.date, -d) === weekISO
  })

  const events = weekBlocks.map((b) => {
    const seg = b.segmentId ? state.segments.find((s) => s.id === b.segmentId) : null
    // Who in this segment's cast is busy during this scheduled block.
    const conflicts = canEdit && seg
      ? conflictsForBlock(avail, castOf(b.segmentId), b.date, b.startMin, b.endMin)
      : []
    return {
      id: b.id,
      day: dayIndexOfISO(b.date),
      startMin: b.startMin,
      endMin: b.endMin,
      color: seg ? segColor(segIndex[seg.id]) : (b.label ? '#94a3b8' : '#a1a1aa'),
      title: seg ? seg.name : (b.label || 'Deleted segment'),
      warn: conflicts.length > 0,
      subtitle: conflicts.length > 0 ? `⚠ ${conflicts.length} can't make it` : undefined,
      tooltip: conflicts.length > 0 ? `Conflicts: ${conflicts.map((m) => m.name).join(', ')}` : undefined,
      onClick: canEdit
        ? () => setDraft({ id: b.id, day: dayIndexOfISO(b.date), startMin: b.startMin, endMin: b.endMin, segmentId: b.segmentId || '', label: b.label || '' })
        : undefined,
    }
  })

  const save = () => {
    const { id, day, startMin, endMin, segmentId } = draft
    const label = (draft.label || '').trim()
    if ((!segmentId && !label) || endMin <= startMin) return
    const date = addDaysISO(weekISO, day)
    const payload = segmentId
      ? { date, startMin, endMin, segmentId, label: null }
      : { date, startMin, endMin, segmentId: null, label }
    if (id) updatePracticeBlock(id, payload)
    else addPracticeBlock(payload)
    setDraft(null)
  }

  return (
    <div>
      <PageHeader
        title="Practice Calendar"
        subtitle={canEdit ? 'Drag on the grid to schedule a segment run — or a note like “watching auditions”.' : 'What’s being practiced when.'}
        actions={
          <>
            <Button size="sm" onClick={() => setWeekISO(addDaysISO(weekISO, -7))}>‹</Button>
            <Button size="sm" onClick={() => setWeekISO(weekStartISO())}>Today</Button>
            <Button size="sm" onClick={() => setWeekISO(addDaysISO(weekISO, 7))}>›</Button>
            <span className="text-sm font-semibold text-ink ml-1 whitespace-nowrap">{fmtWeekRange(weekISO)}</span>
          </>
        }
      />

      {/* Members set their availability; editors check it against a segment's cast. */}
      <MyAvailability />
      {canEdit && <ConflictCheck />}
      {canEdit && <AutoSchedule />}

      <Card className="mb-5">
        {canEdit && state.segments.length === 0 && (
          <p className="px-4 pt-4 -mb-1 text-xs text-muted">
            No segments yet — you can still block out time with a note (e.g. “watching auditions”). Create segments in Set Design to schedule specific pieces.
          </p>
        )}
        <div className="p-3">
          <WeekGrid
            className="hidden sm:block"
            weekISO={weekISO}
            events={events}
            onDragCreate={canEdit
              ? (day, startMin, endMin) =>
                  setDraft({ day, startMin, endMin, segmentId: state.segments[0]?.id ?? '', label: '' })
              : undefined}
          />
          <WeekAgenda
            className="sm:hidden"
            weekISO={weekISO}
            events={events}
            onAddForDay={canEdit
              ? (day) => setDraft({ day, startMin: 18 * 60, endMin: 19 * 60, segmentId: state.segments[0]?.id ?? '', label: '' })
              : undefined}
          />
        </div>
      </Card>

      {canEdit && <Tracker segIndex={segIndex} />}

      {draft && (
        <Modal
          title={draft.id ? 'Edit practice block' : 'Schedule practice'}
          onClose={() => setDraft(null)}
        >
          <Field label="What's being practiced?">
            <Select value={draft.segmentId} onChange={(e) => setDraft({ ...draft, segmentId: e.target.value })}>
              <option value="">Something else — write a note…</option>
              {state.segments.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          {!draft.segmentId && (
            <Field label="Practice note">
              <TextInput
                autoFocus
                placeholder="e.g. Watching auditions, full run-through, notes session"
                value={draft.label ?? ''}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </Field>
          )}
          <Field label="Day">
            <Select value={draft.day} onChange={(e) => setDraft({ ...draft, day: Number(e.target.value) })}>
              {DAY_NAMES.map((d, i) => (
                <option key={d} value={i}>{d} · {fmtDate(addDaysISO(weekISO, i))}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <Select value={draft.startMin} onChange={(e) => setDraft({ ...draft, startMin: Number(e.target.value) })}>
                {TIME_OPTS.map((m) => <option key={m} value={m}>{minToLabel(m)}</option>)}
              </Select>
            </Field>
            <Field label="End">
              <Select value={draft.endMin} onChange={(e) => setDraft({ ...draft, endMin: Number(e.target.value) })}>
                {TIME_OPTS.filter((m) => m > draft.startMin).map((m) => <option key={m} value={m}>{minToLabel(m)}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex justify-between mt-2">
            {draft.id ? (
              <Button variant="danger" onClick={() => { removePracticeBlock(draft.id); setDraft(null) }}>
                Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button onClick={() => setDraft(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={save}
                disabled={(!draft.segmentId && !(draft.label || '').trim()) || draft.endMin <= draft.startMin}
              >
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Per-segment practice metrics. "Practiced" = the scheduled block's end time
// has passed (per your choice: scheduled = practiced).
function Tracker({ segIndex }) {
  const { state } = useStore()
  const now = new Date()
  const todayISO = toISODate(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const thisWeek = weekStartISO()

  const rows = state.segments.map((seg) => {
    const blocks = state.practiceBlocks.filter((b) => b.segmentId === seg.id)
    const past = blocks.filter(
      (b) => b.date < todayISO || (b.date === todayISO && b.endMin <= nowMin),
    )
    const totalMin = past.reduce((n, b) => n + (b.endMin - b.startMin), 0)
    const weekMin = blocks
      .filter((b) => addDaysISO(b.date, -dayIndexOfISO(b.date)) === thisWeek)
      .reduce((n, b) => n + (b.endMin - b.startMin), 0)
    const lastDate = past.map((b) => b.date).sort().at(-1) ?? null
    const upcoming = blocks.filter(
      (b) => b.date > todayISO || (b.date === todayISO && b.endMin > nowMin),
    ).length
    const staleDays = lastDate
      ? Math.round((now - new Date(lastDate)) / 86400000)
      : Infinity
    return { seg, totalMin, weekMin, lastDate, sessions: past.length, upcoming, staleDays }
  })

  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="Practice tracker"
        subtitle="Hours count once a scheduled block's time has passed."
      />
      <div className="px-5 pb-5 overflow-x-auto thin-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="pb-2 pr-3 font-medium">Segment</th>
              <th className="pb-2 pr-3 font-medium">Last practiced</th>
              <th className="pb-2 pr-3 font-medium">Total hours</th>
              <th className="pb-2 pr-3 font-medium">Sessions</th>
              <th className="pb-2 pr-3 font-medium">This week</th>
              <th className="pb-2 font-medium">Upcoming</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ seg, totalMin, weekMin, lastDate, sessions, upcoming, staleDays }) => (
              <tr key={seg.id}>
                <td className="py-2.5 pr-3">
                  <span className="inline-flex items-center gap-2 font-medium text-ink">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: segColor(segIndex[seg.id]) }} />
                    {seg.name}
                  </span>
                </td>
                <td className="py-2.5 pr-3">
                  {lastDate ? (
                    <span className="text-muted">
                      {fmtDate(lastDate)} <span className="text-faint">({relativeDays(lastDate)})</span>
                    </span>
                  ) : (
                    <Badge className="bg-bad-soft text-bad">never</Badge>
                  )}
                  {staleDays !== Infinity && staleDays > 7 && (
                    <Badge className="bg-warn-soft text-warn ml-1.5">stale</Badge>
                  )}
                </td>
                <td className="py-2.5 pr-3 font-semibold text-ink">{durationLabel(totalMin)}</td>
                <td className="py-2.5 pr-3 text-muted">{sessions}</td>
                <td className="py-2.5 pr-3 text-muted">{weekMin ? durationLabel(weekMin) : '—'}</td>
                <td className="py-2.5 text-muted">{upcoming ? `${upcoming} block${upcoming > 1 ? 's' : ''}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
