import { describe, it, expect } from 'vitest'
import {
  isActive, buyerKey, buyerName, buildMatcher, findRosterMatch, duplicatePairs,
  ambiguousBareNames, resolveNames,
} from './matching.js'

describe('isActive', () => {
  it('is active unless explicitly flagged false (legacy rows have no flag)', () => {
    expect(isActive({})).toBe(true)
    expect(isActive({ active: true })).toBe(true)
    expect(isActive({ active: false })).toBe(false)
  })
})

describe('buyerKey / buyerName', () => {
  it('keys by normalized email when present', () => {
    expect(buyerKey({ buyer_email: '  Asha@Example.com ' })).toBe('asha@example.com')
  })

  it('falls back to normalized full name when there is no email', () => {
    expect(buyerKey({ buyer_first: 'Asha', buyer_last: 'Rao' })).toBe('asha rao')
  })

  it('names the buyer from first/last, or email, or "Unknown buyer"', () => {
    expect(buyerName({ buyer_first: 'Asha', buyer_last: 'Rao' })).toBe('Asha Rao')
    expect(buyerName({ buyer_email: 'a@b.com' })).toBe('a@b.com')
    expect(buyerName({})).toBe('Unknown buyer')
  })
})

describe('buildMatcher', () => {
  const roster = [
    { id: 'm1', name: 'Asha Rao' },
    { id: 'm2', name: 'Dev Kumar' },
    { id: 'm3', name: 'Priya Kumar' },   // shares a last name with m2
    { id: 'm4', name: 'Shreyas Patel' }, // shares a first name with m5
    { id: 'm5', name: 'Shreyas Mehta' },
  ]

  it('a manual link takes precedence over everything else', () => {
    const matcher = buildMatcher(roster, { 'random@buyer.com': 'm2' })
    expect(matcher({ buyer_email: 'random@buyer.com', buyer_first: 'Asha', buyer_last: 'Rao' })).toBe('m2')
  })

  it('ignores a manual link pointing at a removed member', () => {
    const matcher = buildMatcher(roster, { 'random@buyer.com': 'no-longer-on-roster' })
    expect(matcher({ buyer_email: 'random@buyer.com' })).toBeNull()
  })

  it('matches an exact full name', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Asha', buyer_last: 'Rao' })).toBe('m1')
  })

  it('matches a unique last name (a parent paying)', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Vikram', buyer_last: 'Rao' })).toBe('m1')
  })

  it('sends an ambiguous last name to the manual queue', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Someone', buyer_last: 'Kumar' })).toBeNull()
  })

  it('falls back to a unique first name when there is no useful last name', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Dev', buyer_last: '' })).toBe('m2')
  })

  it('sends an ambiguous first name to the manual queue', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Shreyas', buyer_last: '' })).toBeNull()
  })

  it('returns null for a total stranger', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Nobody', buyer_last: 'Here' })).toBeNull()
  })
})

describe('findRosterMatch', () => {
  const roster = [
    { id: 'm1', name: 'Akul Laddha' },
    { id: 'm2', name: 'Priya Kumar' },
    { id: 'm3', name: 'Priya Nair' },   // two Priyas -> first name ambiguous
    { id: 'm4', name: 'Sam' },
  ]

  it('matches an exact full name (case-insensitive)', () => {
    expect(findRosterMatch(roster, '  akul laddha ')?.id).toBe('m1')
  })

  it('links a bare first name to the one member it could be', () => {
    expect(findRosterMatch(roster, 'Akul')?.id).toBe('m1')
  })

  it('links a fuller name back to a bare-first-name member', () => {
    expect(findRosterMatch(roster, 'Sam Rivera')?.id).toBe('m4')
  })

  it('refuses to guess when the first name is ambiguous', () => {
    expect(findRosterMatch(roster, 'Priya')).toBeNull()
    expect(findRosterMatch(roster, 'Priya Shah')).toBeNull()
  })

  it('returns null for a genuinely new person', () => {
    expect(findRosterMatch(roster, 'Dev Kumar')).toBeNull()
  })
})

describe('duplicatePairs', () => {
  it('flags a bare first name sitting next to its full name, keeping the fuller one', () => {
    const pairs = duplicatePairs([
      { id: 'a', name: 'Akul' },
      { id: 'b', name: 'Akul Laddha' },
      { id: 'c', name: 'Priya Kumar' },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].keep.id).toBe('b')
    expect(pairs[0].drop.id).toBe('a')
  })

  it('does not flag two different people who share a last name', () => {
    expect(duplicatePairs([
      { id: 'a', name: 'Dev Kumar' },
      { id: 'b', name: 'Priya Kumar' },
    ])).toEqual([])
  })

  it('does not flag two full names that share a first name', () => {
    expect(duplicatePairs([
      { id: 'a', name: 'Priya Kumar' },
      { id: 'b', name: 'Priya Nair' },
    ])).toEqual([])
  })

  it('does NOT offer a merge when a bare name could be two different people', () => {
    // "Rishi" + "Rishi Menon" + "Rishi Dasari" — merging would dump one
    // person's slots onto the other.
    expect(duplicatePairs([
      { id: 'x', name: 'Rishi' },
      { id: 'm', name: 'Rishi Menon' },
      { id: 'd', name: 'Rishi Dasari' },
    ])).toEqual([])
  })
})

describe('ambiguousBareNames', () => {
  it('surfaces a bare first name that matches 2+ full names', () => {
    const out = ambiguousBareNames([
      { id: 'x', name: 'Rishi' },
      { id: 'm', name: 'Rishi Menon' },
      { id: 'd', name: 'Rishi Dasari' },
      { id: 'a', name: 'Akul Laddha' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].bare.id).toBe('x')
    expect(out[0].matches.map((m) => m.id).sort()).toEqual(['d', 'm'])
  })

  it('is silent when a bare name matches only one full name', () => {
    expect(ambiguousBareNames([
      { id: 'x', name: 'Akul' },
      { id: 'a', name: 'Akul Laddha' },
    ])).toEqual([])
  })
})

describe('resolveNames', () => {
  const roster = [
    { id: 'm', name: 'Rishi Menon' },
    { id: 'd', name: 'Rishi Dasari' },
    { id: 'a', name: 'Akul Laddha' },
  ]

  it('marks an exact full-name hit', () => {
    expect(resolveNames(roster, ['Rishi Menon'])[0]).toMatchObject({ status: 'exact', memberId: 'm' })
  })

  it('fuzzy-matches a bare name to the one member it could be', () => {
    expect(resolveNames(roster, ['Akul'])[0]).toMatchObject({ status: 'fuzzy', memberId: 'a' })
  })

  it('flags a bare name that could be two people as ambiguous', () => {
    const r = resolveNames(roster, ['Rishi'])[0]
    expect(r.status).toBe('ambiguous')
    expect(r.memberId).toBeNull()
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['d', 'm'])
  })

  it('does not fuzzy-match one full name to a different full name', () => {
    // "Rishi Kumar" is a new person, not "Rishi Menon" or "Rishi Dasari".
    expect(resolveNames(roster, ['Rishi Kumar'])[0]).toMatchObject({ status: 'new', memberId: null })
  })

  it('dedupes names case-insensitively', () => {
    expect(resolveNames(roster, ['Akul Laddha', 'akul laddha ']).length).toBe(1)
  })
})
