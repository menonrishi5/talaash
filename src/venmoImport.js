// Venmo statement CSV parsing. Venmo exports have a preamble before the real
// header row and quoted fields (notes contain commas/newlines), so this is a
// proper little CSV parser rather than line.split(',').

export function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  return rows
}

// "- $1,234.56" -> -123456 (cents); "+ $30" -> 3000
function parseAmount(s) {
  if (!s) return null
  const m = String(s).replace(/[,$\s]/g, '').match(/^([+-]?)(\d+(?:\.\d{1,2})?)$/)
  if (!m) return null
  const cents = Math.round(Number(m[2]) * 100)
  return m[1] === '-' ? -cents : cents
}

// Returns { rows: [{id, datetime, type, status, note, from_name, to_name,
// amount_cents}], errors: [], skipped: n }
export function parseVenmoCSV(text) {
  const all = parseCSV(text)
  const headerIdx = all.findIndex(
    (r) => r.includes('ID') && r.includes('Datetime') && r.some((c) => c.startsWith('Amount')),
  )
  if (headerIdx === -1) {
    return {
      rows: [],
      errors: ['This doesn\'t look like a Venmo statement CSV — no header row with ID / Datetime / Amount columns found.'],
      skipped: 0,
    }
  }
  const header = all[headerIdx]
  const col = (name) => header.findIndex((h) => h.trim() === name)
  const cID = col('ID')
  const cDT = col('Datetime')
  const cType = col('Type')
  const cStatus = col('Status')
  const cNote = col('Note')
  const cFrom = col('From')
  const cTo = col('To')
  const cAmount = header.findIndex((h) => h.trim() === 'Amount (total)' || h.trim() === 'Amount')

  const rows = []
  const errors = []
  let skipped = 0
  for (let i = headerIdx + 1; i < all.length; i++) {
    const r = all[i]
    const id = (r[cID] ?? '').trim()
    const dt = (r[cDT] ?? '').trim()
    if (!id || !dt) {
      skipped++ // balance/summary/preamble rows
      continue
    }
    const amount = parseAmount(r[cAmount])
    if (amount === null) {
      errors.push(`Row ${i + 1}: couldn't read the amount ("${r[cAmount]}")`)
      continue
    }
    const parsed = new Date(dt)
    rows.push({
      id,
      datetime: isNaN(parsed) ? null : parsed.toISOString(),
      type: (r[cType] ?? '').trim() || null,
      status: (r[cStatus] ?? '').trim() || null,
      note: (r[cNote] ?? '').trim() || null,
      from_name: (r[cFrom] ?? '').trim() || null,
      to_name: (r[cTo] ?? '').trim() || null,
      amount_cents: amount,
    })
  }
  return { rows, errors, skipped }
}
