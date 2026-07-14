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
