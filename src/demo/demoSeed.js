// Synthetic data for demo mode. All names/dues/schedules are made up. The
// practice week is generated relative to "today" so the calendar always looks
// current, and one block is staged with an availability conflict so the
// conflict overlay + auto-scheduler visibly do something on first load.

import { weekStartISO, addDaysISO } from '../lib.js'

export const DEMO_UID = 'demo-user-0000'
export const DEMO_MEMBER_ID = 'm1' // the signed-in "you" in the demo

// --- roster ------------------------------------------------------------------
const roster = [
  { id: 'm1', name: 'Aisha Khan', active: true },
  { id: 'm2', name: 'Rohan Patel', active: true },
  { id: 'm3', name: 'Priya Nair', active: true },
  { id: 'm4', name: 'Dev Sharma', active: true },
  { id: 'm5', name: 'Ananya Rao', active: true },
  { id: 'm6', name: 'Kabir Singh', active: true },
  { id: 'm7', name: 'Meera Iyer', active: true },
  { id: 'm8', name: 'Arjun Mehta', active: true },
  { id: 'm9', name: 'Sanya Gupta', active: true, paymentPlan: true },
  { id: 'm10', name: 'Vikram Reddy', active: true },
  { id: 'm11', name: 'Nisha Verma', active: true },
  { id: 'm12', name: 'Karan Malhotra', active: false },
]

const mem = (id, enterSide = '', exitSide = '') => ({ memberId: id, enterSide, exitSide })

// stage sides are coded 'L' | 'R' | 'C' | '' and mix status is one of
// 'structure' | 'draft' | 'near-finished' | 'finished'.
const segments = [
  {
    id: 's1', name: 'Bollywood', mixStatus: 'finished', notes: 'Opener — full formation.',
    pdf: null, audio: null,
    members: [mem('m1', 'L', 'C'), mem('m2', 'R', 'R'), mem('m3', 'C', 'L'), mem('m4'), mem('m5', 'L', 'C'), mem('m6', 'R', 'R')],
  },
  {
    id: 's2', name: 'Bhangra', mixStatus: 'structure', notes: '',
    pdf: null, audio: null,
    members: [mem('m3'), mem('m4', 'R', 'R'), mem('m6'), mem('m7', 'C', 'C'), mem('m8'), mem('m9', 'L', 'L')],
  },
  {
    id: 's3', name: 'Fusion', mixStatus: 'near-finished', notes: 'Transition into Hip-Hop.',
    pdf: null, audio: null,
    members: [mem('m1'), mem('m5', 'C', 'C'), mem('m7'), mem('m9'), mem('m10', 'R', 'R'), mem('m11')],
  },
  {
    id: 's4', name: 'Hip-Hop', mixStatus: 'finished', notes: 'Closer.',
    pdf: null, audio: null,
    members: [mem('m2'), mem('m6', 'C', 'C'), mem('m8', 'L', 'L'), mem('m10'), mem('m11', 'R', 'R')],
  },
]

// --- this week's practice schedule (Tue/Thu/Sun 7 PM) ------------------------
const wk = weekStartISO() // Monday of the current week
const tueISO = addDaysISO(wk, 1)
const thuISO = addDaysISO(wk, 3)
const sunISO = addDaysISO(wk, 6)
const H = (h, m = 0) => h * 60 + m

const practiceBlocks = [
  { id: 'pb1', segmentId: 's1', date: tueISO, startMin: H(19), endMin: H(20) },   // Bollywood — staged conflict
  { id: 'pb2', segmentId: 's2', date: tueISO, startMin: H(20), endMin: H(21) },   // Bhangra
  { id: 'pb3', segmentId: 's3', date: thuISO, startMin: H(19), endMin: H(20, 30) }, // Fusion
  { id: 'pb4', segmentId: 's4', date: sunISO, startMin: H(19, 30), endMin: H(20, 30) }, // Hip-Hop
]

// --- member availability (busy 30-min blocks after 7 PM; 0 = 7:00) -----------
// Weekly defaults (w:weekday Mon=0) plus a couple of date overrides that create
// the visible conflicts on this week's blocks.
const av = (member_id, key, busy) => ({ member_id, key, busy })
const member_availability = [
  // demo user's own usual times
  av('m1', 'w:1', [3]),
  // weekly patterns that populate the conflict grid / optimizer
  av('m2', 'w:1', [3]),
  av('m4', 'w:1', [2, 3]),
  av('m6', 'w:3', [0]),
  av('m7', 'w:3', [0, 1]),
  av('m8', 'w:1', [2, 3]),
  av('m9', 'w:6', [1]),
  // date overrides → the Bollywood 7–8 PM block on Tuesday has 2 people out
  av('m3', `d:${tueISO}`, [0, 1]),
  av('m5', `d:${tueISO}`, [0]),
  // Fusion Thursday 7–8:30 has 1 out
  av('m9', `d:${thuISO}`, [1, 2]),
]

// --- dues (paid/exempt shown via manual overrides so no Zeffy data needed) ---
const rate = (n) => `rate-${n}`
const dues = {
  categories: [
    { id: 'c1', rateId: rate(1), name: 'Fall Dues', amountCents: 12500, order: 0, dueDate: addDaysISO(wk, -10), lateFinesActive: true },
    { id: 'c2', rateId: rate(2), name: 'Deposit', amountCents: 3000, order: 1 },
    { id: 'c3', rateId: rate(3), name: 'Bootcamp Dues', amountCents: 7500, order: 2 },
  ],
  // keyed by category id (the grid resolves overrides via c.id ?? c.rateId)
  overrides: {
    m1: { c1: 'paid', c2: 'paid', c3: 'paid' },
    m2: { c1: 'paid', c2: 'paid' },
    m3: { c2: 'paid' },
    m4: { c1: 'paid', c2: 'paid', c3: 'paid' },
    m5: { c1: 'paid' },
    m6: { c2: 'exempt' },
    m8: { c1: 'paid', c2: 'paid' },
    m10: { c2: 'paid' },
    m11: { c1: 'paid', c2: 'paid', c3: 'paid' },
  },
  contactLinks: {},
  lateFineWaivers: {},
}

// --- benching (a small template so the tab isn't empty) ----------------------
const benching = {
  locations: ['Gregory Gym', 'RecSports'],
  activeLocation: 'Gregory Gym',
  threshold: 15,
  template: [
    { id: 't1', day: 1, startMin: H(19), endMin: H(21), memberId: 'm2', reserveId: 'm3' },
    { id: 't2', day: 3, startMin: H(19), endMin: H(21), memberId: 'm4', reserveId: null },
    { id: 't3', day: 6, startMin: H(19), endMin: H(21), memberId: 'm7', reserveId: 'm9' },
  ],
  weeks: {},
}

const settings = {
  pdfLeftIsStageLeft: true,
  benchingAcceptDeadlineHours: 12,
  slackDigestChannel: '',
  practiceSchedule: [
    { id: 'p-tue', day: 1, startMin: H(19) },
    { id: 'p-thu', day: 3, startMin: H(19) },
    { id: 'p-sun', day: 6, startMin: H(19) },
  ],
  excuseWindowHours: 5,
  slackAttendanceChannel: '',
  dueFineDefaults: { lateCents: 500, veryLateCents: 1000, veryLateAfterDays: 7 },
}

// The six store domains, as a plain object.
function appStateDomains() {
  return { roster, segments, practiceBlocks, benching, dues, settings }
}

// --- attendance + finances ---------------------------------------------------
// "Today" in the team's timezone, matching todayTeamISO() at runtime. Computed
// locally so this file needn't import supabase.js (which imports this file).
const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const nameOf = (id) => roster.find((m) => m.id === id)?.name ?? 'Unknown'
const at = (dateISO, min = 2) => `${dateISO}T19:${String(min).padStart(2, '0')}:00-05:00`

// A flat check-in row. `attendance_sessions` is embedded so the join in
// MyAttendance (`checkins(…, attendance_sessions(session_date))`) resolves.
let _ci = 0
function ci(session_id, session_date, member_id, { late = 0, fine = 0, no_show = false, min = 2 } = {}) {
  return {
    id: `ci-${++_ci}`, session_id, member_id, member_name: nameOf(member_id),
    mins_late: late, fine, fine_pending: false, no_show,
    checked_at: no_show ? null : at(session_date, min),
    attendance_sessions: { session_date },
  }
}

const sessFields = { cutoff_min: 19 * 60, grace_min: 5, tier1_until_min: 30, tier1_amount: 5, tier2_amount: 10, fines_active: true }

// today's open session — renders as a live practice with people checked in
const todaySessionId = 'sess-today'
const todayCheckins = [
  ci(todaySessionId, todayISO, 'm1', { min: 1 }),
  ci(todaySessionId, todayISO, 'm2', { min: 3 }),
  ci(todaySessionId, todayISO, 'm4', { min: 4 }),
  ci(todaySessionId, todayISO, 'm6', { min: 6 }),
  ci(todaySessionId, todayISO, 'm3', { late: 8, fine: 5, min: 8 }),
  ci(todaySessionId, todayISO, 'm7', { late: 42, fine: 10, min: 42 }),
]

// past sessions — power the ledger + history
const p1 = addDaysISO(todayISO, -3)
const p2 = addDaysISO(todayISO, -5)
const p3 = addDaysISO(todayISO, -7)
const pastCheckins = [
  ci('sess-p1', p1, 'm1'), ci('sess-p1', p1, 'm2'), ci('sess-p1', p1, 'm3'),
  ci('sess-p1', p1, 'm5', { late: 8, fine: 5 }), ci('sess-p1', p1, 'm7'),
  ci('sess-p1', p1, 'm9', { no_show: true }),
  ci('sess-p2', p2, 'm1'), ci('sess-p2', p2, 'm2', { late: 35, fine: 10 }),
  ci('sess-p2', p2, 'm4'), ci('sess-p2', p2, 'm6'), ci('sess-p2', p2, 'm8'),
  ci('sess-p3', p3, 'm1'), ci('sess-p3', p3, 'm3'), ci('sess-p3', p3, 'm5'),
  ci('sess-p3', p3, 'm10', { late: 6, fine: 5 }), ci('sess-p3', p3, 'm11'),
]
const finesFor = (sid) => pastCheckins.filter((c) => c.session_id === sid).map((c) => ({ fine: c.fine }))

const attendance_sessions = [
  { id: todaySessionId, session_date: todayISO, ended_at: null, ...sessFields },
  // past sessions embed checkins(fine) for the History join
  { id: 'sess-p1', session_date: p1, ended_at: at(p1, 55), ...sessFields, checkins: finesFor('sess-p1') },
  { id: 'sess-p2', session_date: p2, ended_at: at(p2, 55), ...sessFields, checkins: finesFor('sess-p2') },
  { id: 'sess-p3', session_date: p3, ended_at: at(p3, 55), ...sessFields, checkins: finesFor('sess-p3') },
]
const session_secrets = [{ session_id: todaySessionId, password: 'TALAASH' }]
const checkins = [...todayCheckins, ...pastCheckins]

// fine payments (settle a couple of balances; leave some outstanding)
const payments = [
  { id: 'pay1', member_id: 'm3', amount: 5, note: 'Venmo', created_at: at(todayISO) },
  { id: 'pay2', member_id: 'm2', amount: 10, note: 'cash', created_at: at(p2, 58) },
]

// excuses — one pending absence to review, one already approved
const excuses = [
  { id: 'ex1', member_id: 'm5', practice_date: addDaysISO(todayISO, 2), coming: false, status: 'pending', reason: 'Midterm exam that night', arrival_min: null, decided_at: null },
  { id: 'ex2', member_id: 'm8', practice_date: p1, coming: false, status: 'approved', reason: 'Family in town', arrival_min: null, decided_at: at(p1) },
]

// reimbursements — one pending, one approved (partly offsetting dues), one paid
const reimbursements = [
  { id: 'rb1', member_id: 'm3', status: 'pending', amount_cents: 4250, description: 'Props — fabric & safety pins', category: 'Props', purchase_date: addDaysISO(todayISO, -2), created_at: at(todayISO, 10) },
  { id: 'rb2', member_id: 'm5', status: 'approved', amount_cents: 6000, approved_amount_cents: 6000, dues_credit_cents: 2500, description: 'Competition entry — shared van gas', category: 'Travel', purchase_date: p2, created_at: at(p2, 20) },
  { id: 'rb3', member_id: 'm2', status: 'paid', amount_cents: 3000, approved_amount_cents: 3000, dues_credit_cents: 0, paid_amount_cents: 3000, paid_at: at(p3, 30), description: 'Rehearsal room deposit', category: 'Venue', purchase_date: p3, created_at: at(p3, 10) },
]

// The demo "session" that flows through auth.jsx. Email matches an owner email
// so the demo shows the full owner/editor experience.
export const demoSession = {
  access_token: 'demo',
  user: { id: DEMO_UID, email: 'menonrishi5@gmail.com' },
}

const profiles = [
  { id: DEMO_UID, email: 'menonrishi5@gmail.com', role: 'editor', member_id: DEMO_MEMBER_ID, slack_email: null },
]

// Deep-cloned each call so every fresh mock client / store mount starts clean.
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)))

// Store state (used by store.jsx load() in demo mode).
export function demoAppState() {
  return clone(appStateDomains())
}

// Full table set for the mock Supabase client. Unlisted tables default to [].
export function demoTables() {
  const domains = appStateDomains()
  return clone({
    app_state: Object.keys(domains).map((key) => ({ key, data: domains[key] })),
    profiles,
    member_availability,
    reimbursements,
    payments,
    checkins,
    attendance_sessions,
    session_secrets,
    excuses,
    // no synthetic Zeffy/Venmo data — those screens key off external imports
    zeffy_payments: [],
    attendance_announcements: [],
    slot_responses: [],
    venmo_transactions: [],
    notification_log: [],
    files: [],
    receipts: [],
  })
}
