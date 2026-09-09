// Zeffy buyer -> roster member matching.
// Order of precedence:
//   1. Manual link (learned once, applies to all payments from that buyer)
//   2. Exact full-name match
//   3. Last-name match, but only when exactly ONE roster member has that
//      last name (covers parents paying: "Vikram Saluja" -> Arav Saluja).
//      Two members sharing a last name -> ambiguous -> manual queue.

export const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
export const lastWord = (s) => norm(s).split(' ').at(-1) || ''

export const buyerKey = (p) =>
  norm(p.buyer_email) || norm(`${p.buyer_first ?? ''} ${p.buyer_last ?? ''}`)

export const buyerName = (p) =>
  `${p.buyer_first ?? ''} ${p.buyer_last ?? ''}`.trim() || p.buyer_email || 'Unknown buyer'

export function buildMatcher(roster, contactLinks = {}) {
  const ids = new Set(roster.map((m) => m.id))
  const byFull = {}
  const byLast = {}
  const byFirst = {}
  for (const m of roster) {
    const full = norm(m.name)
    byFull[full] = m.id
    const words = full.split(' ')
    if (words[0]) (byFirst[words[0]] = byFirst[words[0]] || []).push(m.id)
    if (words.length > 1) {
      const last = words.at(-1)
      ;(byLast[last] = byLast[last] || []).push(m.id)
    }
  }
  return (p) => {
    const linked = contactLinks[buyerKey(p)]
    if (linked && ids.has(linked)) return linked // ignore links to removed members
    const full = norm(`${p.buyer_first ?? ''} ${p.buyer_last ?? ''}`)
    if (byFull[full]) return byFull[full]
    const last = p.buyer_last ? lastWord(p.buyer_last) : full.includes(' ') ? lastWord(full) : ''
    const lastHits = byLast[last] ?? []
    if (lastHits.length === 1) return lastHits[0]
    // First-name fallback (Zeffy contacts with no last name): only when the
    // first name is unique on the roster — duplicates (the two Shreyas) go
    // to the manual queue instead of being guessed.
    const first = norm(p.buyer_first || '').split(' ')[0] || full.split(' ')[0]
    const firstHits = byFirst[first] ?? []
    if (firstHits.length === 1) return firstHits[0]
    return null // unknown or ambiguous -> manual queue
  }
}

// A member is active unless explicitly flagged otherwise (legacy rows have no flag).
export const isActive = (m) => m.active !== false

// ---- roster de-duplication ----
// A benching sheet often lists someone by a shorter name than the roster
// ("Akul" for "Akul Laddha", or the reverse). Blindly adding every new name
// creates a phantom second member who then shows up as a permanent no-show in
// attendance. These helpers link/collapse those instead.

// The roster member `name` almost certainly refers to, or null when it's
// genuinely new (or too ambiguous to guess). Exact case-insensitive full-name
// match wins; otherwise a one-word name links to the SINGLE roster member
// whose name starts with that word, and a multi-word name links to the SINGLE
// roster member who is exactly its first word. 2+ candidates -> null.
export function findRosterMatch(roster, name) {
  const key = norm(name)
  if (!key) return null
  const exact = roster.find((m) => norm(m.name) === key)
  if (exact) return exact
  const first = key.split(' ')[0]
  const multi = key.includes(' ')
  const cands = roster.filter((m) => {
    const n = norm(m.name)
    if (!multi) return n === first || n.startsWith(first + ' ')
    return n === first
  })
  return cands.length === 1 ? cands[0] : null
}

// Pairs of existing roster members that look like the same person: a bare
// first name sitting next to exactly one fuller name that starts with it
// ("Akul" / "Akul Laddha"). Returns [{ keep, drop }] with `keep` = the fuller
// name. A bare name that could be TWO different people ("Rishi" with both
// "Rishi Menon" and "Rishi Dasari" on the roster) is left out — merging it
// would dump one person's slots onto the other. Use `ambiguousBareNames` to
// surface those for manual reassignment instead.
export function duplicatePairs(roster) {
  const raw = []
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const a = norm(roster[i].name)
      const b = norm(roster[j].name)
      if (!a || !b || a === b) continue
      const [short, long, shortM, longM] =
        a.length <= b.length ? [a, b, roster[i], roster[j]] : [b, a, roster[j], roster[i]]
      if (short.includes(' ')) continue // only bare-first-name vs full-name pairs
      if (short !== long.split(' ')[0]) continue
      raw.push({ keep: longM, drop: shortM })
    }
  }
  const dropCount = {}
  raw.forEach((p) => (dropCount[p.drop.id] = (dropCount[p.drop.id] || 0) + 1))
  return raw.filter((p) => dropCount[p.drop.id] === 1)
}

// Bare first-name roster members that match 2+ fuller names — genuinely
// different people who share a first name, plus a stray bare entry (usually
// from an old import). Not safely mergeable; the editor must reassign the
// bare entry's slots by hand. Returns [{ bare, matches: [members] }].
export function ambiguousBareNames(roster) {
  const out = []
  for (const m of roster) {
    const nm = norm(m.name)
    if (!nm || nm.includes(' ')) continue
    const matches = roster.filter((o) => o.id !== m.id && norm(o.name).split(' ')[0] === nm)
    if (matches.length >= 2) out.push({ bare: m, matches })
  }
  return out
}

// For the benching-sheet import: resolve each sheet name to an existing roster
// member, or flag it. status: 'exact' | 'fuzzy' (one unambiguous match) |
// 'ambiguous' (2+ possible people — editor must choose) | 'new'.
export function resolveNames(roster, names) {
  const seen = new Set()
  const out = []
  for (const raw of names) {
    const name = String(raw).trim()
    const key = norm(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const exact = roster.find((m) => norm(m.name) === key)
    if (exact) { out.push({ name, key, status: 'exact', memberId: exact.id, candidates: [] }); continue }
    const first = key.split(' ')[0]
    const multi = key.includes(' ')
    const candidates = roster.filter((m) => {
      const nm = norm(m.name)
      if (nm === key) return true
      return multi ? nm === first : nm === first || nm.startsWith(first + ' ')
    })
    if (candidates.length === 1)
      out.push({ name, key, status: 'fuzzy', memberId: candidates[0].id, candidates })
    else if (candidates.length >= 2)
      out.push({ name, key, status: 'ambiguous', memberId: null, candidates })
    else
      out.push({ name, key, status: 'new', memberId: null, candidates: [] })
  }
  return out
}
