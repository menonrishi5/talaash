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

// Pairs of existing roster members that look like the same person: same first
// name, and one name is the other's prefix (or just the bare first name).
// Returns [{ keep, drop }] with `keep` = the fuller name.
export function duplicatePairs(roster) {
  const out = []
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const a = norm(roster[i].name)
      const b = norm(roster[j].name)
      if (!a || !b || a === b) continue
      const [short, long, shortM, longM] =
        a.length <= b.length ? [a, b, roster[i], roster[j]] : [b, a, roster[j], roster[i]]
      if (short.includes(' ')) continue // only bare-first-name vs full-name pairs
      if (short !== long.split(' ')[0]) continue
      out.push({ keep: longM, drop: shortM })
    }
  }
  return out
}
