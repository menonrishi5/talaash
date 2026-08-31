import { useRef, useState } from 'react'
import { DAY_SHORT, DAY_NAMES, addDaysISO, fmtDate, minToLabel, toISODate, dayIndexOfISO } from '../lib.js'

// Google-Calendar-style week grid.
// events: [{ id, day (0=Mon..6=Sun), startMin, endMin, color, title, subtitle, dashed, onClick }]
// onDragCreate(day, startMin, endMin) — enables click-drag creation when provided.

const START_HOUR = 8
const END_HOUR = 24
const PX_PER_30 = 26
const SNAP = 30

const minY = (min) => ((min - START_HOUR * 60) / 30) * PX_PER_30
const totalHeight = (END_HOUR - START_HOUR) * 2 * PX_PER_30

function yToMin(y) {
  const raw = START_HOUR * 60 + (y / PX_PER_30) * 30
  const snapped = Math.round(raw / SNAP) * SNAP
  return Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, snapped))
}

// Assign overlapping events side-by-side lanes within a day.
function layoutDay(events) {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const lanes = []
  const placed = sorted.map((ev) => {
    let lane = 0
    while (lanes[lane] !== undefined && lanes[lane] > ev.startMin) lane++
    lanes[lane] = ev.endMin
    return { ev, lane }
  })
  // events overlapping share the max lane count of their cluster
  return placed.map(({ ev, lane }) => {
    const overlapping = placed.filter(
      (p) => p.ev.startMin < ev.endMin && p.ev.endMin > ev.startMin,
    )
    const laneCount = Math.max(...overlapping.map((p) => p.lane)) + 1
    return { ev, lane, laneCount }
  })
}

export default function WeekGrid({ weekISO, events, onDragCreate, className = '' }) {
  // Drag state lives in a ref (read by event handlers, which can fire several
  // times between renders) and is mirrored to state for the preview render.
  const dragRef = useRef(null)
  const [drag, setDragState] = useState(null) // {day, anchorMin, startMin, endMin}
  const setDrag = (d) => { dragRef.current = d; setDragState(d) }
  const colRefs = useRef({})
  const todayISO = toISODate(new Date())

  const hours = []
  for (let h = START_HOUR; h < END_HOUR; h++) hours.push(h)

  const startDrag = (day, e) => {
    if (!onDragCreate || e.button !== 0) return
    const rect = colRefs.current[day].getBoundingClientRect()
    const min = yToMin(e.clientY - rect.top)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDrag({ day, anchorMin: min, startMin: min, endMin: min + SNAP })
  }

  const moveDrag = (e) => {
    const d = dragRef.current
    if (!d) return
    const rect = colRefs.current[d.day].getBoundingClientRect()
    const min = yToMin(e.clientY - rect.top)
    setDrag({
      ...d,
      startMin: Math.min(d.anchorMin, min),
      endMin: Math.max(d.anchorMin + SNAP, min),
    })
  }

  const endDrag = () => {
    const d = dragRef.current
    if (!d) return
    setDrag(null)
    onDragCreate(d.day, d.startMin, Math.max(d.endMin, d.startMin + SNAP))
  }

  return (
    <div className={`overflow-x-auto thin-scroll ${className}`}>
      <div className="min-w-[860px]">
        {/* Day headers */}
        <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
          <div />
          {DAY_SHORT.map((d, i) => {
            const iso = addDaysISO(weekISO, i)
            const isToday = iso === todayISO
            return (
              <div key={d} className="px-2 py-2 text-center border-b border-line">
                <div className={`text-[11px] font-medium uppercase tracking-wide ${isToday ? 'text-ink' : 'text-faint'}`}>
                  {d}
                </div>
                <div
                  className={`text-sm font-semibold mt-0.5 inline-flex items-center justify-center ${
                    isToday ? 'bg-accent text-accent-ink rounded-full w-7 h-7' : 'text-ink'
                  }`}
                >
                  {fmtDate(iso, { day: 'numeric' })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Grid body */}
        <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
          {/* time gutter */}
          <div className="relative" style={{ height: totalHeight }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[10px] text-faint"
                style={{ top: minY(h * 60) }}
              >
                {h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`}
              </div>
            ))}
          </div>

          {DAY_SHORT.map((_, day) => {
            const dayEvents = layoutDay(events.filter((ev) => ev.day === day))
            return (
              <div
                key={day}
                ref={(el) => (colRefs.current[day] = el)}
                className={`relative border-l border-line ${onDragCreate ? 'cursor-crosshair' : ''}`}
                style={{ height: totalHeight }}
                onPointerDown={(e) => startDrag(day, e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-line"
                    style={{ top: minY(h * 60) }}
                  />
                ))}

                {dayEvents.map(({ ev, lane, laneCount }) => (
                  <div
                    key={ev.id}
                    role={ev.onClick ? 'button' : undefined}
                    tabIndex={ev.onClick ? 0 : undefined}
                    aria-label={`${ev.title}, ${minToLabel(ev.startMin)} to ${minToLabel(ev.endMin)}`}
                    onClick={(e) => { e.stopPropagation(); ev.onClick?.() }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ev.onClick?.() } }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`absolute rounded-lg px-2 py-1 text-[11px] leading-tight overflow-hidden transition-shadow ${
                      ev.onClick ? 'cursor-pointer hover:shadow-md' : ''
                    } ${ev.dashed ? 'border-2 border-dashed bg-surface/70' : 'text-white shadow-sm'}`}
                    style={{
                      top: minY(ev.startMin) + 1,
                      height: Math.max(minY(ev.endMin) - minY(ev.startMin) - 2, 18),
                      left: `calc(${(lane / laneCount) * 100}% + 2px)`,
                      width: `calc(${(1 / laneCount) * 100}% - 4px)`,
                      background: ev.dashed ? undefined : ev.color,
                      borderColor: ev.dashed ? ev.color : undefined,
                      color: ev.dashed ? ev.color : undefined,
                    }}
                    title={ev.tooltip
                      ? `${ev.title} · ${minToLabel(ev.startMin)} – ${minToLabel(ev.endMin)}\n${ev.tooltip}`
                      : `${ev.title} · ${minToLabel(ev.startMin)} – ${minToLabel(ev.endMin)}${ev.subtitle ? `\n${ev.subtitle}` : ''}`}
                  >
                    {ev.warn && (
                      <span
                        className="absolute top-0.5 right-0.5 text-[10px] leading-none"
                        style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,.5))' }}
                      >⚠️</span>
                    )}
                    {ev.warn && !ev.dashed && (
                      <span className="absolute inset-0 rounded-lg pointer-events-none" style={{ boxShadow: 'inset 0 0 0 2px var(--bad)' }} />
                    )}
                    <div className="font-semibold truncate">{ev.title}</div>
                    {ev.subtitle && <div className="truncate opacity-90">{ev.subtitle}</div>}
                    <div className="opacity-75">{minToLabel(ev.startMin)} – {minToLabel(ev.endMin)}</div>
                  </div>
                ))}

                {/* drag preview */}
                {drag && drag.day === day && (
                  <div
                    className="absolute inset-x-0.5 rounded-lg bg-accent/15 border-2 border-dashed border-accent pointer-events-none flex items-center justify-center"
                    style={{ top: minY(drag.startMin), height: minY(drag.endMin) - minY(drag.startMin) }}
                  >
                    <span className="text-[11px] font-medium text-ink">
                      {minToLabel(drag.startMin)} – {minToLabel(drag.endMin)}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Phone-friendly single-day view of the same events. Shows one day at a time
// with a prev/next stepper; tapping an event fires its onClick. Optional
// onAddForDay(day) renders an "add" button under the list.
export function WeekAgenda({ weekISO, events, onAddForDay, className = '' }) {
  const todayISO = toISODate(new Date())
  const todayIdx = dayIndexOfISO(todayISO)
  const weekHasToday = addDaysISO(todayISO, -todayIdx) === weekISO
  const [dayIdx, setDayIdx] = useState(weekHasToday ? todayIdx : 0)

  const dateISO = addDaysISO(weekISO, dayIdx)
  const dayEvents = events
    .filter((ev) => ev.day === dayIdx)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setDayIdx((d) => (d + 6) % 7)}
          className="p-2 -ml-2 rounded-lg text-muted hover:bg-subtle hover:text-ink cursor-pointer"
          aria-label="Previous day"
        >‹</button>
        <div className="text-center">
          <div className={`text-sm font-semibold ${dateISO === todayISO ? 'text-accent' : 'text-ink'}`}>
            {DAY_NAMES[dayIdx]}
          </div>
          <div className="text-[11px] text-faint">{fmtDate(dateISO, { month: 'short', day: 'numeric' })}</div>
        </div>
        <button
          onClick={() => setDayIdx((d) => (d + 1) % 7)}
          className="p-2 -mr-2 rounded-lg text-muted hover:bg-subtle hover:text-ink cursor-pointer"
          aria-label="Next day"
        >›</button>
      </div>

      {dayEvents.length === 0 ? (
        <p className="text-sm text-faint italic text-center py-6">Nothing scheduled.</p>
      ) : (
        <ul className="space-y-2">
          {dayEvents.map((ev) => (
            <li key={ev.id}>
              <button
                onClick={ev.onClick}
                disabled={!ev.onClick}
                className="w-full text-left rounded-xl border border-line px-3 py-2.5 flex items-start gap-3 disabled:cursor-default enabled:cursor-pointer enabled:hover:border-line-strong transition-colors"
                style={ev.warn ? { boxShadow: 'inset 0 0 0 2px var(--bad)' } : undefined}
              >
                <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ background: ev.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink truncate">
                    {ev.warn && '⚠ '}{ev.title}
                  </span>
                  {ev.subtitle && <span className="block text-xs text-muted truncate">{ev.subtitle}</span>}
                  <span className="block text-xs text-faint">
                    {minToLabel(ev.startMin)} – {minToLabel(ev.endMin)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {onAddForDay && (
        <button
          onClick={() => onAddForDay(dayIdx)}
          className="mt-3 w-full rounded-xl border border-dashed border-line-strong py-2.5 text-sm font-medium text-muted hover:text-ink hover:border-faint cursor-pointer transition-colors"
        >
          ＋ Add block
        </button>
      )}
    </div>
  )
}

export { START_HOUR, END_HOUR }
