import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  teamParts, teamNow, nextPractice,
  minToLabel, minToShort, parseTime, durationLabel,
  toISODate, fromISODate, weekStartISO, addDaysISO, dayIndexOfISO,
  fmtWeekRange, relativeDays, parseDay, parseBenchingSheet,
  segColor, SEGMENT_COLORS, sideLabel,
} from './lib.js'

// ---- teamParts / teamNow ----
// These are the functions behind the locale bug that broke Announce/check-in
// for real: some browsers don't return ISO from toLocaleDateString('en-CA'),
// so teamParts reads Intl parts directly instead of parsing a formatted
// string. Pin exact UTC instants so these tests don't depend on the host's
// own locale or timezone.

describe('teamParts', () => {
  it('reads Chicago wall-clock time (CDT, UTC-5) from a UTC instant', () => {
    // 2026-09-03T00:04:00Z = 2026-09-02 19:04 America/Chicago (CDT)
    const p = teamParts(new Date(Date.UTC(2026, 8, 3, 0, 4, 0)))
    expect(p.iso).toBe('2026-09-02')
    expect(p.hour).toBe(19)
    expect(p.minute).toBe(4)
    expect(p.min).toBe(19 * 60 + 4)
    expect(p.day).toBe(2) // Wednesday, Mon=0
  })

  it('does not let a UTC date rollover leak into the Chicago date', () => {
    // 2026-09-03T03:00:00Z is already "the 3rd" in UTC, but still the
    // evening of the 2nd in Chicago — a naive date.toISOString() would get
    // this wrong.
    const p = teamParts(new Date(Date.UTC(2026, 8, 3, 3, 0, 0)))
    expect(p.iso).toBe('2026-09-02')
    expect(p.hour).toBe(22)
  })

  it('handles the winter CST offset (UTC-6) too', () => {
    // 2026-01-15T20:00:00Z = 2026-01-15 14:00 America/Chicago (CST)
    const p = teamParts(new Date(Date.UTC(2026, 0, 15, 20, 0, 0)))
    expect(p.iso).toBe('2026-01-15')
    expect(p.hour).toBe(14)
    expect(p.day).toBe(3) // Thursday
  })

  it('teamNow() matches teamParts() for the real current instant', () => {
    const now = teamNow()
    const parts = teamParts()
    expect(now.iso).toBe(parts.iso)
    expect(now.min).toBe(parts.min)
    expect(now.day).toBe(parts.day)
  })
})

// ---- nextPractice ----

describe('nextPractice', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns null for an empty schedule', () => {
    expect(nextPractice([])).toBeNull()
    expect(nextPractice(undefined)).toBeNull()
  })

  it('finds a practice later today', () => {
    // Wednesday 2026-09-02, 15:00 Chicago (CDT) = 20:00 UTC.
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 2, 20, 0, 0)))
    const schedule = [{ day: 2, startMin: 19 * 60 }] // Wed 7pm
    const next = nextPractice(schedule)
    expect(next.dateISO).toBe('2026-09-02')
    expect(next.day).toBe(2)
    expect(next.minsUntil).toBe(4 * 60) // 15:00 -> 19:00
  })

  it("skips today's practice once it has already started", () => {
    // Wednesday 2026-09-02, 20:00 Chicago (CDT) = 01:00 UTC next day.
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 3, 1, 0, 0)))
    const schedule = [{ day: 2, startMin: 19 * 60 }] // today's 7pm already passed
    const next = nextPractice(schedule)
    expect(next.dateISO).toBe('2026-09-09') // next Wednesday
  })

  it('regression: Mon/Tue/Thu schedule from a Wednesday finds Thursday, not null', () => {
    // This is the exact shape that was broken in production: teamNow()'s
    // day came back NaN in some browsers, so no schedule entry ever matched
    // and Announce always failed with "set up your practice schedule".
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 2, 18, 0, 0))) // Wed 13:00 CDT
    const schedule = [
      { day: 0, startMin: 19 * 60 }, // Monday
      { day: 1, startMin: 19 * 60 }, // Tuesday
      { day: 3, startMin: 19 * 60 }, // Thursday
    ]
    const next = nextPractice(schedule)
    expect(next).not.toBeNull()
    expect(next.day).toBe(3)
    expect(next.dateISO).toBe('2026-09-03')
  })

  it('picks the soonest of several same-day entries', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 2, 17, 0, 0))) // Wed 12:00 CDT
    const schedule = [
      { day: 2, startMin: 20 * 60 },
      { day: 2, startMin: 18 * 60 },
    ]
    expect(nextPractice(schedule).startMin).toBe(18 * 60)
  })
})

// ---- time helpers ----

describe('minToLabel', () => {
  it.each([
    [0, '12 AM'],
    [60, '1 AM'],
    [720, '12 PM'],
    [750, '12:30 PM'],
    [1439, '11:59 PM'],
    [19 * 60, '7 PM'],
  ])('%i -> %s', (min, label) => {
    expect(minToLabel(min)).toBe(label)
  })
})

describe('minToShort', () => {
  it('drops AM/PM and minutes when :00', () => {
    expect(minToShort(13 * 60)).toBe('1')
    expect(minToShort(13 * 60 + 30)).toBe('1:30')
  })
})

describe('parseTime', () => {
  it('treats a bare hour before 8 as PM (practice/benching context)', () => {
    expect(parseTime('1')).toBe(13 * 60)
    expect(parseTime('1:30')).toBe(13 * 60 + 30)
  })

  it('leaves 8 and later alone without a meridiem', () => {
    expect(parseTime('8:00')).toBe(8 * 60)
    expect(parseTime('19:00')).toBe(19 * 60)
  })

  it('honors an explicit am/pm', () => {
    expect(parseTime('7pm')).toBe(19 * 60)
    expect(parseTime('7:15 AM')).toBe(7 * 60 + 15)
    expect(parseTime('12:00 AM')).toBe(0)
    expect(parseTime('12:00 PM')).toBe(12 * 60)
  })

  it('rejects garbage and out-of-range values', () => {
    expect(parseTime('')).toBeNull()
    expect(parseTime(null)).toBeNull()
    expect(parseTime('25:00')).toBeNull()
    expect(parseTime('9:70')).toBeNull()
    expect(parseTime('not a time')).toBeNull()
  })
})

describe('durationLabel', () => {
  it.each([
    [0, '0m'],
    [30, '30m'],
    [60, '1h'],
    [90, '1h 30m'],
    [125, '2h 5m'],
  ])('%i minutes -> %s', (mins, label) => {
    expect(durationLabel(mins)).toBe(label)
  })
})

// ---- date helpers ----

describe('date helpers', () => {
  it('toISODate / fromISODate round-trip', () => {
    const iso = '2026-09-02'
    expect(toISODate(fromISODate(iso))).toBe(iso)
  })

  it('weekStartISO finds the preceding Monday', () => {
    // 2026-09-02 is a Wednesday; its Monday is 2026-08-31.
    expect(weekStartISO(fromISODate('2026-09-02'))).toBe('2026-08-31')
    // A Monday is its own week start.
    expect(weekStartISO(fromISODate('2026-08-31'))).toBe('2026-08-31')
  })

  it('addDaysISO rolls over months and years correctly', () => {
    expect(addDaysISO('2026-01-30', 5)).toBe('2026-02-04')
    expect(addDaysISO('2026-12-30', 5)).toBe('2027-01-04')
    expect(addDaysISO('2026-09-02', -2)).toBe('2026-08-31')
  })

  it('dayIndexOfISO is Monday-based (0=Mon..6=Sun)', () => {
    expect(dayIndexOfISO('2026-08-31')).toBe(0) // Monday
    expect(dayIndexOfISO('2026-09-02')).toBe(2) // Wednesday
    expect(dayIndexOfISO('2026-09-06')).toBe(6) // Sunday
  })

  it('fmtWeekRange spans Monday through the following Sunday', () => {
    const range = fmtWeekRange('2026-08-31')
    expect(range).toContain('Aug 31')
    expect(range).toContain('Sep 6')
  })

  it('relativeDays is self-consistent with "now"', () => {
    const today = toISODate(new Date())
    expect(relativeDays(today)).toBe('today')
    expect(relativeDays(addDaysISO(today, -1))).toBe('yesterday')
    expect(relativeDays(addDaysISO(today, 1))).toBe('tomorrow')
    expect(relativeDays(addDaysISO(today, -5))).toBe('5 days ago')
    expect(relativeDays(addDaysISO(today, 5))).toBe('in 5 days')
  })
})

// ---- schedule-sheet parsing ----

describe('parseDay', () => {
  it('recognizes full names, abbreviations, and is case-insensitive', () => {
    expect(parseDay('Monday')).toBe(0)
    expect(parseDay('tue')).toBe(1)
    expect(parseDay('THURS')).toBe(3)
    expect(parseDay('Sunday')).toBe(6)
  })

  it('returns null for anything else', () => {
    expect(parseDay('funday')).toBeNull()
    expect(parseDay('')).toBeNull()
    expect(parseDay(undefined)).toBeNull()
  })
})

describe('parseBenchingSheet', () => {
  it('parses comma-separated rows and carries the day down', () => {
    const { rows, errors } = parseBenchingSheet(
      'Thursday, 1:00, 2:30, Person A, Person E\n2:30, 4:00, Person B, Person E',
    )
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ day: 3, startMin: 13 * 60, endMin: 14 * 60 + 30, member: 'Person A', reserve: 'Person E' })
    expect(rows[1]).toMatchObject({ day: 3, startMin: 14 * 60 + 30, endMin: 16 * 60, member: 'Person B' })
  })

  it('accepts a combined "start - end" field', () => {
    const { rows, errors } = parseBenchingSheet('Sunday, 12:00 PM - 1:30 PM, Person C, Person D')
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ day: 6, startMin: 12 * 60, endMin: 13 * 60 + 30, member: 'Person C' })
  })

  it('skips a header row', () => {
    const { rows, errors } = parseBenchingSheet('Day, Start, End, Member, Reserve\nMonday, 1:00, 2:00, Asha')
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
  })

  it('parses tab-separated rows (Google Sheets paste)', () => {
    const { rows } = parseBenchingSheet('Monday\t1:00\t2:00\tAsha\tDev')
    expect(rows[0]).toMatchObject({ day: 0, member: 'Asha', reserve: 'Dev' })
  })

  it('errors on a missing member', () => {
    const { rows, errors } = parseBenchingSheet('Monday, 1:00, 2:00')
    expect(rows).toHaveLength(0)
    expect(errors[0]).toMatch(/expected/i)
  })

  it('errors when end is not after start', () => {
    const { errors } = parseBenchingSheet('Monday, 2:00, 1:00, Asha')
    expect(errors[0]).toMatch(/end time/i)
  })

  it('errors when no day can be identified yet', () => {
    const { errors } = parseBenchingSheet('1:00, 2:00, Asha')
    expect(errors[0]).toMatch(/couldn't identify a day/i)
  })
})

// ---- misc display helpers ----

describe('segColor', () => {
  it('wraps around the palette by index', () => {
    expect(segColor(0)).toBe(SEGMENT_COLORS[0])
    expect(segColor(SEGMENT_COLORS.length)).toBe(SEGMENT_COLORS[0])
    expect(segColor(SEGMENT_COLORS.length + 1)).toBe(SEGMENT_COLORS[1])
  })
})

describe('sideLabel', () => {
  it('labels known sides and falls back for unknown ones', () => {
    expect(sideLabel('L')).toBe('Stage Left')
    expect(sideLabel('nonsense')).toBe('—')
  })
})
