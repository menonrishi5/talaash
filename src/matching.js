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
  const byFull = {}
  const byLast = {}
  for (const m of roster) {
    byFull[norm(m.name)] = m.id
    const lw = lastWord(m.name)
    if (lw) (byLast[lw] = byLast[lw] || []).push(m.id)
  }
  return (p) => {
    const linked = contactLinks[buyerKey(p)]
    if (linked) return linked
    const full = norm(`${p.buyer_first ?? ''} ${p.buyer_last ?? ''}`)
    if (byFull[full]) return byFull[full]
    const last = p.buyer_last ? lastWord(p.buyer_last) : lastWord(full)
    const candidates = byLast[last] ?? []
    if (candidates.length === 1) return candidates[0]
    return null // unknown or ambiguous -> manual queue
  }
}

// A member is active unless explicitly flagged otherwise (legacy rows have no flag).
export const isActive = (m) => m.active !== false
