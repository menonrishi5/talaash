// Shared helpers: ids, time math, date math, schedule-sheet parsing.

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TEAM_TZ = 'America/Chicago'

// Current time in the team's timezone: { iso 'YYYY-MM-DD', min (since midnight), day 0-6 Mon=0 }.
export function teamNow() {
  const now = new Date()
  const iso = now.toLocaleDateString('en-CA', { timeZone: TEAM_TZ })
  const [h, m] = now
    .toLocaleTimeString('en-GB', { timeZone: TEAM_TZ, hour12: false, hour: '2-digit', minute: '2-digit' })
    .split(':')
    .map(Number)
  const day = (new Date(iso + 'T00:00:00').getDay() + 6) % 7 // Mon=0
  return { iso, min: h * 60 + m, day }
}

// The soonest upcoming practice from a weekly schedule ([{day,startMin}]),
// relative to team-local now. Returns { dateISO, day, startMin, minsUntil } or null.
export function nextPractice(schedule, windowHours = 0) {
  if (!schedule?.length) return null
  const { iso, min, day } = teamNow()
  let best = null
  for (let ahead = 0; ahead <= 7; ahead++) {
    const d = (day + ahead) % 7
    for (const p of schedule) {
      if (p.day !== d) continue
      // today: only if it hasn't already started
      if (ahead === 0 && p.startMin <= min) continue
      const minsUntil = ahead * 1440 + (p.startMin - min)
      if (best === null || minsUntil < best.minsUntil) {
        best = { dateISO: addDaysISO(iso, ahead), day: d, startMin: p.startMin, minsUntil }
      }
    }
    if (best && ahead >= 0 && best.minsUntil <= (ahead + 1) * 1440) break
  }
  return best
}

// ---- time (minutes since midnight) ----

export function minToLabel(min) {
  let h = Math.floor(min / 60) % 24
  const m = min % 60
  const mer = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return m === 0 ? `${h} ${mer}` : `${h}:${String(m).padStart(2, '0')} ${mer}`
}

export function minToShort(min) {
  let h = Math.floor(min / 60)
  const m = min % 60
  h = h % 12 || 12
  return m === 0 ? `${h}` : `${h}:${String(m).padStart(2, '0')}`
}

// Parses "1", "1:30", "1:30 PM", "13:00", "7pm". Bare hours before 8 are
// assumed PM (benching/practice happens afternoon-evening).
export function parseTime(str) {
  if (!str) return null
  const s = String(str).trim().toLowerCase()
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\.?m?\.?$/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const mins = m[2] ? parseInt(m[2], 10) : 0
  if (h > 24 || mins > 59) return null
  const mer = m[3]
  if (mer) {
    if (mer.startsWith('p') && h !== 12) h += 12
    if (mer.startsWith('a') && h === 12) h = 0
  } else if (h < 8) {
    h += 12 // heuristic: "1:00" means 1 PM in this context
  }
  return h * 60 + mins
}

export function durationLabel(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

// ---- dates (local, Monday-based weeks) ----

export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fromISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Monday of the week containing `date`, as ISO string.
export function weekStartISO(date = new Date()) {
  const d = new Date(date)
  const shift = (d.getDay() + 6) % 7 // Mon=0 .. Sun=6
  d.setDate(d.getDate() - shift)
  return toISODate(d)
}

export function addDaysISO(iso, days) {
  const d = fromISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export function dayIndexOfISO(iso) {
  return (fromISODate(iso).getDay() + 6) % 7
}

export function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) {
  return fromISODate(iso).toLocaleDateString('en-US', opts)
}

export function fmtWeekRange(weekISO) {
  return `${fmtDate(weekISO)} – ${fmtDate(addDaysISO(weekISO, 6))}`
}

export function relativeDays(iso) {
  const today = fromISODate(toISODate(new Date()))
  const diff = Math.round((today - fromISODate(iso)) / 86400000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'yesterday'
  if (diff === -1) return 'tomorrow'
  if (diff > 1) return `${diff} days ago`
  return `in ${-diff} days`
}

const DAY_LOOKUP = {
  mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, weds: 2, wednesday: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3, fri: 4, friday: 4,
  sat: 5, saturday: 5, sun: 6, sunday: 6,
}

export function parseDay(str) {
  const key = String(str || '').trim().toLowerCase()
  return key in DAY_LOOKUP ? DAY_LOOKUP[key] : null
}

// ---- benching sheet parsing ----
// Accepts lines of: Day, Start, End, Member[, Reserve]
// Separated by commas or tabs (Google Sheets paste). Day may be omitted on
// continuation lines to reuse the previous one. Also accepts "Start - End" as
// a single field. Returns { rows: [{day,startMin,endMin,member,reserve}], errors: [] }
export function parseBenchingSheet(text) {
  const rows = []
  const errors = []
  let currentDay = null
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    let parts = line.includes('\t') ? line.split('\t') : line.split(',')
    parts = parts.map((p) => p.trim()).filter((p) => p !== '')
    if (parts.length === 0) return
    // header row?
    if (/^day$/i.test(parts[0])) return

    let day = parseDay(parts[0])
    if (day !== null) {
      currentDay = day
      parts = parts.slice(1)
    } else {
      day = currentDay
    }
    if (day === null) {
      errors.push(`Line ${i + 1}: couldn't identify a day ("${line.slice(0, 40)}")`)
      return
    }

    // allow "1:00 - 2:30" combined in one field
    if (parts[0] && /[-–]/.test(parts[0]) && parseTime(parts[0]) === null) {
      const [a, b] = parts[0].split(/[-–]/)
      parts = [a, b, ...parts.slice(1)]
    }

    const startMin = parseTime(parts[0])
    const endMin = parseTime(parts[1])
    const member = parts[2]
    const reserve = parts[3] || null
    if (startMin === null || endMin === null || !member) {
      errors.push(`Line ${i + 1}: expected "Day, Start, End, Member, Reserve" ("${line.slice(0, 40)}")`)
      return
    }
    if (endMin <= startMin) {
      errors.push(`Line ${i + 1}: end time is not after start time`)
      return
    }
    rows.push({ day, startMin, endMin, member, reserve })
  })
  return { rows, errors }
}

// Distinct, friendly colors assigned to segments by index.
export const SEGMENT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9',
  '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#84cc16',
  '#06b6d4', '#a855f7',
]

export const segColor = (index) => SEGMENT_COLORS[index % SEGMENT_COLORS.length]

export const MIX_STATUSES = [
  { value: 'structure', label: 'Structure', cls: 'bg-zinc-200 text-zinc-700' },
  { value: 'draft', label: 'Draft', cls: 'bg-amber-100 text-amber-800' },
  { value: 'near-finished', label: 'Near-finished', cls: 'bg-sky-100 text-sky-800' },
  { value: 'finished', label: 'Finished', cls: 'bg-emerald-100 text-emerald-800' },
]

export const SIDES = [
  { value: 'L', label: 'Stage Left' },
  { value: 'R', label: 'Stage Right' },
  { value: 'C', label: 'Center / On stage' },
  { value: '', label: '—' },
]

export const sideLabel = (v) => (SIDES.find((s) => s.value === v)?.label ?? '—')
