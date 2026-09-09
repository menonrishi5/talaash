import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { uid } from './lib.js'
import { supabase } from './supabase.js'
import { useAuth } from './auth.jsx'
import { findRosterMatch } from './matching.js'

// App state lives in Supabase (table app_state, one JSON doc per domain) so
// every device sees the same data. localStorage is kept as a fast local cache
// for instant first paint; the server copy wins on load.

const KEY = 'talaash-hq-v1'
const DOMAIN_KEYS = ['roster', 'segments', 'practiceBlocks', 'benching', 'dues', 'settings']

const DEFAULT_STATE = {
  roster: [], // {id, name}
  segments: [], // array order = show order
  // segment: {id, name, mixStatus, notes, pdf:{fileId,name}|null, audio:{fileId,name}|null,
  //           members: [{memberId, enterSide, exitSide}]}
  practiceBlocks: [], // {id, segmentId, date:'YYYY-MM-DD', startMin, endMin}
  benching: {
    locations: [],
    activeLocation: null,
    threshold: 15,
    template: [], // {id, day:0-6, startMin, endMin, memberId, reserveId|null, week?:'A'|'B'}
    // Anchor Monday (ISO) defined as a Week A. null = no A/B rotation.
    rotationAnchorISO: null,
    // per-week overrides keyed by week start ISO, then template slot id:
    // { [weekISO]: { [slotId]: { status: 'primary'|'reserve'|'cover'|'uncovered', coverMemberId } } }
    weeks: {},
  },
  dues: {
    // category: {id, rateId, name, amountCents, order,
    //   dueDate?, lateCents?, veryLateCents?, veryLateAfterDays?, lateFinesActive?}
    categories: [],
    // per-member manual cell states: { [memberId]: { [rateId]: 'paid' | 'exempt' } }
    overrides: {},
    // zeffy buyer (email or "first last", lowercased) -> roster member id
    contactLinks: {},
    // per-member, per-category late-fine forgiveness: { [memberId]: { [catId]: true } }
    lateFineWaivers: {},
  },
  settings: {
    // Is the left of the forms-PDF page the performers' stage left?
    pdfLeftIsStageLeft: true,
    // Unaccepted benching slots pass to the reserve this many hours before start.
    benchingAcceptDeadlineHours: 12,
    // Slack channel id for the weekly benching digest (bot must be in it).
    slackDigestChannel: '',
    // Weekly practice schedule: [{id, day:0-6 (Mon=0), startMin}]. Anchors the
    // excuse-form deadline. Defaults to the team's Tue/Thu/Sun 7 PM.
    practiceSchedule: [
      { id: 'p-tue', day: 1, startMin: 19 * 60 },
      { id: 'p-thu', day: 3, startMin: 19 * 60 },
      { id: 'p-sun', day: 6, startMin: 19 * 60 },
    ],
    // Excuse form closes this many hours before a practice starts.
    excuseWindowHours: 5,
    // Slack channel id for attendance announcements (bot must be in it).
    slackAttendanceChannel: '',
    // Default late-payment fine rule, overridable per fee category.
    dueFineDefaults: { lateCents: 500, veryLateCents: 1000, veryLateAfterDays: 7 },
  },
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_STATE,
      ...parsed,
      benching: { ...DEFAULT_STATE.benching, ...(parsed.benching || {}) },
      dues: { ...DEFAULT_STATE.dues, ...(parsed.dues || {}) },
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
    }
  } catch {
    return DEFAULT_STATE
  }
}

const StoreCtx = createContext(null)

export function StoreProvider({ children }) {
  const { canEdit } = useAuth()
  const [state, setState] = useState(load)
  const [syncStatus, setSyncStatus] = useState('connecting') // connecting | synced | saving | offline
  const loadedRef = useRef(false)
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  const lastSynced = useRef({}) // domain key -> JSON string last written to/read from server
  const saveTimer = useRef(null)

  // Initial pull: server copy wins; if the server is empty (first ever run),
  // seed it from whatever this browser has locally.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.from('app_state').select('key,data')
        if (error) throw error
        if (cancelled) return
        if (data.length === 0) {
          // First ever run: seed the server from this browser (editors only —
          // viewers can't write, and shouldn't define the team's data anyway).
          if (canEditRef.current) {
            const local = load()
            const rows = DOMAIN_KEYS.map((k) => ({ key: k, data: local[k] }))
            const { error: upErr } = await supabase.from('app_state').upsert(rows)
            if (upErr) throw upErr
            DOMAIN_KEYS.forEach((k) => (lastSynced.current[k] = JSON.stringify(local[k])))
          }
        } else {
          const merged = { ...DEFAULT_STATE }
          for (const row of data) if (DOMAIN_KEYS.includes(row.key)) merged[row.key] = row.data
          merged.benching = { ...DEFAULT_STATE.benching, ...(merged.benching || {}) }
          merged.dues = { ...DEFAULT_STATE.dues, ...(merged.dues || {}) }
          merged.settings = { ...DEFAULT_STATE.settings, ...(merged.settings || {}) }
          DOMAIN_KEYS.forEach((k) => (lastSynced.current[k] = JSON.stringify(merged[k])))
          setState(merged)
        }
        loadedRef.current = true
        setSyncStatus('synced')
      } catch (e) {
        console.error('Supabase load failed — working from local cache.', e)
        loadedRef.current = true
        if (!cancelled) setSyncStatus('offline')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist: localStorage immediately, server debounced (only changed domains).
  // Viewers never push — the database would reject it anyway.
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(state))
    if (!loadedRef.current || !canEditRef.current) return
    const changed = DOMAIN_KEYS.filter(
      (k) => JSON.stringify(state[k]) !== lastSynced.current[k],
    )
    if (changed.length === 0) return
    setSyncStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const rows = changed.map((k) => ({
          key: k,
          data: state[k],
          updated_at: new Date().toISOString(),
        }))
        const { error } = await supabase.from('app_state').upsert(rows)
        if (error) throw error
        changed.forEach((k) => (lastSynced.current[k] = JSON.stringify(state[k])))
        setSyncStatus('synced')
      } catch (e) {
        console.error('Supabase save failed — changes kept locally.', e)
        setSyncStatus('offline')
      }
    }, 800)
  }, [state, canEdit])

  const api = useMemo(() => {
    const set = setState

    return {
      state,
      syncStatus,

      // ---- roster ----
      addMember(name) {
        const member = { id: uid(), name: name.trim(), active: true }
        set((s) => ({ ...s, roster: [...s.roster, member] }))
        return member
      },
      setMemberActive(id, active) {
        set((s) => ({
          ...s,
          roster: s.roster.map((m) => (m.id === id ? { ...m, active } : m)),
        }))
      },
      // On a payment plan → blanket exemption from all late-payment fines.
      setMemberPaymentPlan(id, paymentPlan) {
        set((s) => ({
          ...s,
          roster: s.roster.map((m) => (m.id === id ? { ...m, paymentPlan } : m)),
        }))
      },
      renameMember(id, name) {
        set((s) => ({ ...s, roster: s.roster.map((m) => (m.id === id ? { ...m, name } : m)) }))
      },
      removeMember(id) {
        set((s) => ({
          ...s,
          roster: s.roster.filter((m) => m.id !== id),
          segments: s.segments.map((seg) => ({
            ...seg,
            members: seg.members.filter((mm) => mm.memberId !== id),
          })),
          benching: {
            ...s.benching,
            template: s.benching.template.map((t) => ({
              ...t,
              memberId: t.memberId === id ? null : t.memberId,
              reserveId: t.reserveId === id ? null : t.reserveId,
            })),
          },
        }))
      },
      // Find or create members by name; returns a name->id map. Matching is
      // fuzzy on purpose: "Akul" links to an existing "Akul Laddha" (and a
      // fuller "Akul Laddha" upgrades a bare "Akul") instead of spawning a
      // duplicate that then haunts attendance as a permanent no-show. Only
      // unambiguous matches link — anything with 2+ candidates is added new.
      ensureMembers(names) {
        const map = {}
        const additions = []
        const renames = {} // existing member id -> fuller name to adopt
        for (const name of names) {
          const clean = name.trim()
          const key = clean.toLowerCase()
          if (map[key]) continue
          const inBatch = additions.find((m) => m.name.trim().toLowerCase() === key)
          const found = inBatch || findRosterMatch([...state.roster, ...additions], clean)
          if (found) {
            map[key] = found.id
            // Adopt the more complete spelling when the sheet has it.
            if (
              !inBatch &&
              clean.includes(' ') &&
              !found.name.trim().includes(' ') &&
              clean.toLowerCase().startsWith(found.name.trim().toLowerCase() + ' ')
            ) {
              renames[found.id] = clean
            }
          } else {
            const member = { id: uid(), name: clean, active: true }
            additions.push(member)
            map[key] = member.id
          }
        }
        if (additions.length || Object.keys(renames).length) {
          set((s) => ({
            ...s,
            roster: [
              ...s.roster.map((m) => (renames[m.id] ? { ...m, name: renames[m.id] } : m)),
              ...additions,
            ],
          }))
        }
        return map
      },

      // Fold a duplicate roster member (`dropId`) into the real one (`keepId`)
      // everywhere the app stores a member id. Relational tables (checkins,
      // benching responses, …) are repointed separately by the merge_members
      // RPC — this only touches the app_state JSON docs.
      mergeMembers(dropId, keepId) {
        if (!dropId || !keepId || dropId === keepId) return
        const to = (id) => (id === dropId ? keepId : id)
        const foldKeyed = (obj) => {
          if (!obj || !obj[dropId]) return obj
          const { [dropId]: moved, ...rest } = obj
          return { ...rest, [keepId]: { ...(rest[keepId] || {}), ...moved } }
        }
        set((s) => ({
          ...s,
          roster: s.roster.filter((m) => m.id !== dropId),
          segments: s.segments.map((seg) => {
            const seen = new Set()
            return {
              ...seg,
              members: seg.members
                .map((mm) => ({ ...mm, memberId: to(mm.memberId) }))
                .filter((mm) => !seen.has(mm.memberId) && seen.add(mm.memberId)),
            }
          }),
          benching: {
            ...s.benching,
            template: s.benching.template.map((t) => ({
              ...t,
              memberId: to(t.memberId),
              reserveId: t.reserveId ? to(t.reserveId) : t.reserveId,
            })),
            weeks: Object.fromEntries(
              Object.entries(s.benching.weeks || {}).map(([wk, ov]) => [
                wk,
                Object.fromEntries(
                  Object.entries(ov).map(([slotId, v]) => [
                    slotId,
                    {
                      ...v,
                      ...(v.coverMemberId ? { coverMemberId: to(v.coverMemberId) } : {}),
                      ...(v.memberId ? { memberId: to(v.memberId) } : {}),
                      ...(v.reserveId ? { reserveId: to(v.reserveId) } : {}),
                    },
                  ]),
                ),
              ]),
            ),
          },
          dues: {
            ...s.dues,
            overrides: foldKeyed(s.dues.overrides),
            lateFineWaivers: foldKeyed(s.dues.lateFineWaivers),
            contactLinks: Object.fromEntries(
              Object.entries(s.dues.contactLinks || {}).map(([k, v]) => [k, to(v)]),
            ),
          },
        }))
      },

      // ---- segments ----
      addSegment(name) {
        const seg = {
          id: uid(), name, mixStatus: 'structure', notes: '',
          pdf: null, audio: null, members: [],
        }
        set((s) => ({ ...s, segments: [...s.segments, seg] }))
        return seg
      },
      updateSegment(id, patch) {
        set((s) => ({
          ...s,
          segments: s.segments.map((seg) => (seg.id === id ? { ...seg, ...patch } : seg)),
        }))
      },
      removeSegment(id) {
        set((s) => ({
          ...s,
          segments: s.segments.filter((seg) => seg.id !== id),
          practiceBlocks: s.practiceBlocks.filter((b) => b.segmentId !== id),
        }))
      },
      moveSegment(id, dir) {
        set((s) => {
          const i = s.segments.findIndex((seg) => seg.id === id)
          const j = i + dir
          if (i < 0 || j < 0 || j >= s.segments.length) return s
          const segments = [...s.segments]
          ;[segments[i], segments[j]] = [segments[j], segments[i]]
          return { ...s, segments }
        })
      },
      toggleSegmentMember(segId, memberId) {
        set((s) => ({
          ...s,
          segments: s.segments.map((seg) => {
            if (seg.id !== segId) return seg
            const has = seg.members.some((m) => m.memberId === memberId)
            return {
              ...seg,
              members: has
                ? seg.members.filter((m) => m.memberId !== memberId)
                : [...seg.members, { memberId, enterSide: '', exitSide: '' }],
            }
          }),
        }))
      },
      setMemberSide(segId, memberId, field, value) {
        set((s) => ({
          ...s,
          segments: s.segments.map((seg) =>
            seg.id === segId
              ? {
                  ...seg,
                  members: seg.members.map((m) =>
                    m.memberId === memberId ? { ...m, [field]: value } : m,
                  ),
                }
              : seg,
          ),
        }))
      },

      // ---- practice calendar ----
      addPracticeBlock(block) {
        set((s) => ({ ...s, practiceBlocks: [...s.practiceBlocks, { id: uid(), ...block }] }))
      },
      updatePracticeBlock(id, patch) {
        set((s) => ({
          ...s,
          practiceBlocks: s.practiceBlocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        }))
      },
      removePracticeBlock(id) {
        set((s) => ({ ...s, practiceBlocks: s.practiceBlocks.filter((b) => b.id !== id) }))
      },

      // ---- dues ----
      setDues(patch) {
        set((s) => ({ ...s, dues: { ...s.dues, ...patch } }))
      },

      // ---- settings ----
      setSettings(patch) {
        set((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
      },

      // ---- benching ----
      setBenching(patch) {
        set((s) => ({ ...s, benching: { ...s.benching, ...patch } }))
      },
      addLocation(name) {
        set((s) => {
          const locations = [...s.benching.locations, name.trim()]
          return {
            ...s,
            benching: {
              ...s.benching,
              locations,
              activeLocation: s.benching.activeLocation ?? name.trim(),
            },
          }
        })
      },
      removeLocation(name) {
        set((s) => ({
          ...s,
          benching: {
            ...s.benching,
            locations: s.benching.locations.filter((l) => l !== name),
            activeLocation: s.benching.activeLocation === name ? null : s.benching.activeLocation,
          },
        }))
      },
      // Replaces the weekly template. Past confirmations are kept — they carry
      // their own snapshot of times/people, so hour totals survive re-imports.
      // With `week` ('A' | 'B') only that half of an A/B rotation is replaced;
      // slots tagged with the other letter (or untagged) are left alone.
      setTemplate(slots, week = null) {
        set((s) => {
          const tagged = week ? slots.map((sl) => ({ ...sl, week })) : slots
          const kept = week ? s.benching.template.filter((t) => t.week && t.week !== week) : []
          return { ...s, benching: { ...s.benching, template: [...kept, ...tagged] } }
        })
      },
      // Anchor Monday for A/B rotation, defined as a Week A. null turns
      // rotation off (every slot then applies every week).
      setRotationAnchor(anchorISO) {
        set((s) => ({ ...s, benching: { ...s.benching, rotationAnchorISO: anchorISO || null } }))
      },
      addTemplateSlot(slot) {
        set((s) => ({
          ...s,
          benching: { ...s.benching, template: [...s.benching.template, { id: uid(), ...slot }] },
        }))
      },
      updateTemplateSlot(id, patch) {
        set((s) => ({
          ...s,
          benching: {
            ...s.benching,
            template: s.benching.template.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          },
        }))
      },
      removeTemplateSlot(id) {
        set((s) => {
          const weeks = {}
          for (const [wk, ov] of Object.entries(s.benching.weeks)) {
            const { [id]: _drop, ...rest } = ov
            weeks[wk] = rest
          }
          return {
            ...s,
            benching: {
              ...s.benching,
              template: s.benching.template.filter((t) => t.id !== id),
              weeks,
            },
          }
        })
      },
      // `snapshot` = {day, startMin, endMin, memberId, reserveId} copied from the
      // template slot at confirmation time, so stats don't depend on the
      // template still containing that slot.
      setSlotStatus(weekISO, slotId, status, coverMemberId = null, snapshot = null) {
        set((s) => {
          const week = { ...(s.benching.weeks[weekISO] || {}) }
          if (status === null) delete week[slotId]
          else week[slotId] = { status, coverMemberId, ...snapshot }
          return { ...s, benching: { ...s.benching, weeks: { ...s.benching.weeks, [weekISO]: week } } }
        })
      },

      // ---- danger zone ----
      resetAll() {
        set(DEFAULT_STATE)
      },
    }
  }, [state, syncStatus])

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}
