// In-memory stand-in for the Supabase client, used only in demo mode. It backs
// a small but faithful slice of the PostgREST query-builder API — enough for
// every .from(...).select/insert/upsert/update/delete chain the app makes —
// plus no-op auth/rpc/functions/storage so no screen crashes. Writes mutate the
// in-memory tables (so edits show within the session) but never persist; a page
// refresh rebuilds everything from the seed.

import { demoTables, demoSession } from './demoSeed.js'
import { exitDemo } from './demoMode.js'

// Primary keys, so upsert/insert know what "conflict" means per table.
const PK = {
  app_state: ['key'],
  member_availability: ['member_id', 'key'],
  profiles: ['id'],
}

let _seq = 1
const genId = () => `demo-${Date.now()}-${_seq++}`

function matches(row, filters) {
  return filters.every(([op, col, val]) => {
    const cell = row[col]
    switch (op) {
      case 'eq': return cell === val
      case 'neq': return cell !== val
      case 'in': return Array.isArray(val) && val.includes(cell)
      case 'is': return cell === val || (val === null && cell == null)
      case 'gt': return cell > val
      case 'gte': return cell >= val
      case 'lt': return cell < val
      case 'lte': return cell <= val
      case 'like':
      case 'ilike': {
        const re = new RegExp('^' + String(val).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', op === 'ilike' ? 'i' : '')
        return re.test(String(cell ?? ''))
      }
      default: return true // unknown filter → don't exclude
    }
  })
}

class Query {
  constructor(db, table) {
    this.db = db
    this.table = table
    this.op = 'select'
    this.filters = []
    this.payload = null
    this.opts = null
    this._order = null
    this._limit = null
    this._single = false
    this._maybe = false
  }

  get rows() {
    if (!this.db[this.table]) this.db[this.table] = []
    return this.db[this.table]
  }

  // filters (all chainable)
  eq(c, v) { this.filters.push(['eq', c, v]); return this }
  neq(c, v) { this.filters.push(['neq', c, v]); return this }
  in(c, v) { this.filters.push(['in', c, v]); return this }
  is(c, v) { this.filters.push(['is', c, v]); return this }
  gt(c, v) { this.filters.push(['gt', c, v]); return this }
  gte(c, v) { this.filters.push(['gte', c, v]); return this }
  lt(c, v) { this.filters.push(['lt', c, v]); return this }
  lte(c, v) { this.filters.push(['lte', c, v]); return this }
  like(c, v) { this.filters.push(['like', c, v]); return this }
  ilike(c, v) { this.filters.push(['ilike', c, v]); return this }
  or() { return this } // treated as no-op filter (returns everything)
  contains() { return this }

  // shaping
  order(col, opts) { this._order = { col, asc: !(opts && opts.ascending === false) }; return this }
  limit(n) { this._limit = n; return this }
  range(a, b) { this._limit = b - a + 1; return this }

  // operations
  select() { if (this.op !== 'select') this._returning = true; return this }
  insert(payload) { this.op = 'insert'; this.payload = payload; return this }
  upsert(payload, opts) { this.op = 'upsert'; this.payload = payload; this.opts = opts; return this }
  update(payload) { this.op = 'update'; this.payload = payload; return this }
  delete() { this.op = 'delete'; return this }
  single() { this._single = true; return this }
  maybeSingle() { this._maybe = true; return this }

  _pk() {
    if (this.opts?.onConflict) return this.opts.onConflict.split(',').map((s) => s.trim())
    return PK[this.table] || ['id']
  }

  _run() {
    try {
      const rows = this.rows
      let data

      if (this.op === 'select') {
        data = rows.filter((r) => matches(r, this.filters))
      } else if (this.op === 'delete') {
        const keep = [], removed = []
        for (const r of rows) (matches(r, this.filters) ? removed : keep).push(r)
        this.db[this.table] = keep
        data = removed
      } else if (this.op === 'update') {
        data = []
        for (const r of rows) {
          if (matches(r, this.filters)) { Object.assign(r, this.payload); data.push(r) }
        }
      } else {
        // insert / upsert
        const items = Array.isArray(this.payload) ? this.payload : [this.payload]
        const pk = this._pk()
        data = []
        for (const item of items) {
          const rec = { ...item }
          if (this.op === 'upsert') {
            const idx = rows.findIndex((r) => pk.every((k) => r[k] === rec[k]))
            if (idx >= 0) { Object.assign(rows[idx], rec); data.push(rows[idx]); continue }
          }
          if (rec.id == null && (pk.includes('id') || PK[this.table] === undefined)) rec.id = genId()
          rows.push(rec)
          data.push(rec)
        }
      }

      if (this._order) {
        const { col, asc } = this._order
        data = [...data].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1))
      }
      if (this._limit != null) data = data.slice(0, this._limit)

      if (this._single || this._maybe) {
        return { data: data[0] ?? null, error: null, count: data.length }
      }
      return { data, error: null, count: data.length }
    } catch (e) {
      return { data: null, error: { message: String(e?.message ?? e) } }
    }
  }

  // thenable — `await supabase.from(...)...` resolves to { data, error }
  then(onResolve, onReject) {
    try { return Promise.resolve(this._run()).then(onResolve, onReject) }
    catch (e) { return Promise.reject(e).then(onResolve, onReject) }
  }
  catch(onReject) { return this.then(undefined, onReject) }
}

function rpc(db, name, args) {
  switch (name) {
    case 'submit_excuse':
      db.excuses.push({ id: genId(), ...(args || {}), status: (args?.p_coming ? 'approved' : 'pending') })
      return { data: null, error: null }
    case 'my_calendar_token':
      return { data: 'demo-calendar-token', error: null }
    case 'get_my_dues':
      return { data: [], error: null }
    case 'get_checkin_info':
      return { data: { open: false, demo: true }, error: null }
    case 'check_in':
      return { data: { ok: true, demo: true }, error: null }
    case 'respond_to_slot':
      return { data: null, error: null }
    default:
      return { data: null, error: null }
  }
}

export function createMockClient() {
  const db = demoTables()

  const auth = {
    getSession: async () => ({ data: { session: demoSession }, error: null }),
    getUser: async () => ({ data: { user: demoSession.user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ data: { session: demoSession, user: demoSession.user }, error: null }),
    signUp: async () => ({ data: {}, error: { message: 'Sign-up is disabled in the demo.' } }),
    signOut: async () => { exitDemo(); return { error: null } },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user: demoSession.user }, error: null }),
  }

  const storageBucket = {
    upload: async () => ({ data: { path: 'demo/file' }, error: null }),
    remove: async () => ({ data: [], error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
    getPublicUrl: () => ({ data: { publicUrl: '' } }),
    download: async () => ({ data: null, error: { message: 'Files are disabled in the demo.' } }),
  }

  return {
    __demo: true,
    from: (table) => new Query(db, table),
    rpc: async (name, args) => rpc(db, name, args),
    functions: { invoke: async () => ({ data: { ok: true, synced: 0, demo: true }, error: null }) },
    storage: { from: () => storageBucket },
    auth,
  }
}
