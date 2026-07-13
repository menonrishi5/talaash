import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { uid } from './lib.js'

// Single app-state store persisted to localStorage. When Firebase (Firestore)
// is added, this provider becomes the sync layer; component code stays put.

const KEY = 'talaash-hq-v1'

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
    template: [], // {id, day:0-6, startMin, endMin, memberId, reserveId|null}
    // per-week overrides keyed by week start ISO, then template slot id:
    // { [weekISO]: { [slotId]: { status: 'primary'|'reserve'|'cover'|'uncovered', coverMemberId } } }
    weeks: {},
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
    }
  } catch {
    return DEFAULT_STATE
  }
}

const StoreCtx = createContext(null)

export function StoreProvider({ children }) {
  const [state, setState] = useState(load)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(state))
  }, [state])

  const api = useMemo(() => {
    const set = setState

    return {
      state,

      // ---- roster ----
      addMember(name) {
        const member = { id: uid(), name: name.trim() }
        set((s) => ({ ...s, roster: [...s.roster, member] }))
        return member
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
      // find or create members by (case-insensitive) name; returns name->id map
      ensureMembers(names) {
        const map = {}
        const additions = []
        for (const name of names) {
          const key = name.trim().toLowerCase()
          const found =
            state.roster.find((m) => m.name.trim().toLowerCase() === key) ||
            additions.find((m) => m.name.trim().toLowerCase() === key)
          if (found) {
            map[key] = found.id
          } else {
            const member = { id: uid(), name: name.trim() }
            additions.push(member)
            map[key] = member.id
          }
        }
        if (additions.length) set((s) => ({ ...s, roster: [...s.roster, ...additions] }))
        return map
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
      setTemplate(slots) {
        set((s) => ({ ...s, benching: { ...s.benching, template: slots } }))
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
  }, [state])

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}
