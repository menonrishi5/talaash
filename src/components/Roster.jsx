import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase } from '../supabase.js'
import { isActive } from '../matching.js'
import { Button, Card, CardHeader, TextInput, EmptyState, Badge, Select } from './ui.jsx'

export default function Roster() {
  const { state, addMember, renameMember, removeMember, setMemberActive } = useStore()
  const { canEdit } = useAuth()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null) // member id

  const segCount = useMemo(() => {
    const counts = {}
    for (const seg of state.segments)
      for (const m of seg.members) counts[m.memberId] = (counts[m.memberId] || 0) + 1
    return counts
  }, [state.segments])

  const add = () => {
    const n = name.trim()
    if (!n) return
    addMember(n)
    setName('')
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-zinc-900 mb-1">Team Roster</h1>
      <p className="text-sm text-zinc-500 mb-5">
        Everyone here is selectable in segments, benching, and attendance.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <Card>
          <CardHeader
            title={`Members (${state.roster.length})`}
            subtitle={`${state.roster.filter(isActive).length} active · ${state.roster.filter((m) => !isActive(m)).length} inactive. Inactive members can't be placed on benching, segments, or check in.`}
          />
          <div className="px-5 pb-5">
            {canEdit && (
              <div className="flex gap-2 mb-4">
                <TextInput
                  placeholder="Add a member…"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && add()}
                />
                <Button variant="primary" onClick={add}>Add</Button>
              </div>
            )}

            {state.roster.length === 0 ? (
              <EmptyState
                icon={<span className="text-lg">👥</span>}
                title="No members yet"
                hint={canEdit
                  ? 'Add your team above, or paste a benching sheet in the Benching tab — unknown names are added automatically.'
                  : 'An editor can add the team here.'}
              />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {state.roster.map((m) => (
                  <li key={m.id} className={`flex items-center gap-3 py-2.5 ${isActive(m) ? '' : 'opacity-60'}`}>
                    <div className="w-8 h-8 rounded-full bg-zinc-200 text-zinc-600 flex items-center justify-center text-xs font-semibold shrink-0">
                      {m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    {editing === m.id ? (
                      <TextInput
                        autoFocus
                        defaultValue={m.name}
                        onBlur={(e) => {
                          if (e.target.value.trim()) renameMember(m.id, e.target.value.trim())
                          setEditing(null)
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                      />
                    ) : (
                      <span className="flex-1 text-sm font-medium text-zinc-800">{m.name}</span>
                    )}
                    {!isActive(m) && <Badge className="bg-amber-100 text-amber-800">inactive</Badge>}
                    {segCount[m.id] ? (
                      <Badge className="bg-zinc-100 text-zinc-600">{segCount[m.id]} segment{segCount[m.id] > 1 ? 's' : ''}</Badge>
                    ) : null}
                    {canEdit && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setMemberActive(m.id, !isActive(m))}
                          title={isActive(m) ? 'Mark inactive — removed from pickers, kept in history' : 'Mark active again'}
                        >
                          {isActive(m) ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(m.id)}>Rename</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => {
                            if (confirm(`Remove ${m.name} from the roster? They'll be pulled from all segments.`))
                              removeMember(m.id)
                          }}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <TeamAccess />
      </div>
    </div>
  )
}

// App accounts and their roles. Editors can promote/demote; role changes are
// enforced by the database, this UI just edits the profiles table.
function TeamAccess() {
  const { canEdit, session } = useAuth()
  const { state } = useStore()
  const [profiles, setProfiles] = useState(null)
  const [error, setError] = useState(null)

  const loadProfiles = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at')
    if (error) setError(error.message)
    else setProfiles(data)
  }

  useEffect(() => {
    loadProfiles()
  }, [])

  const update = async (id, patch) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) alert('Could not update the account: ' + error.message)
    loadProfiles()
  }

  return (
    <Card>
      <CardHeader
        title="App access"
        subtitle="Accounts, their role, and which roster member each account IS. The member link powers own-only dues, benching accept/decline, and Slack notifications."
      />
      <div className="px-5 pb-5">
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        {!profiles ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="text-sm text-zinc-400 italic">No accounts yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {profiles.map((p) => {
              const member = state.roster.find((m) => m.id === p.member_id)
              return (
                <li key={p.id} className="flex items-center gap-2 py-2.5 flex-wrap">
                  <span className="flex-1 min-w-40 text-sm text-zinc-800 truncate">
                    {p.email}
                    {p.id === session?.user?.id && <span className="text-zinc-400"> (you)</span>}
                  </span>
                  {canEdit ? (
                    <Select
                      className="!w-44 !py-1 !text-xs"
                      value={p.member_id ?? ''}
                      onChange={(e) => update(p.id, { member_id: e.target.value || null })}
                      title="Which roster member is this account?"
                    >
                      <option value="">not linked</option>
                      {state.roster.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </Select>
                  ) : member ? (
                    <Badge className="bg-zinc-100 text-zinc-600">{member.name}</Badge>
                  ) : null}
                  {canEdit && (
                    <input
                      type="email"
                      defaultValue={p.slack_email ?? ''}
                      placeholder="Slack email (if different)"
                      title="Set only if this person's Slack email differs from their login email, so DM reminders reach them."
                      className="w-48 px-2 py-1 text-xs bg-white border border-zinc-300 rounded-lg"
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v !== (p.slack_email ?? '')) update(p.id, { slack_email: v || null })
                      }}
                    />
                  )}
                  {canEdit && p.id !== session?.user?.id ? (
                    <Select
                      className="!w-28 !py-1 !text-xs"
                      value={p.role}
                      onChange={(e) => update(p.id, { role: e.target.value })}
                    >
                      <option value="viewer">viewer</option>
                      <option value="editor">editor</option>
                    </Select>
                  ) : (
                    <Badge className={p.role === 'editor' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}>
                      {p.role}
                    </Badge>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-[11px] text-zinc-400 mt-3">
          Anyone on the team can create an account from the sign-in page — they start as a viewer.
          Link each account to its roster member so members see their own dues and can accept
          benching slots. Set a Slack email only when it differs from the login email, so DM
          reminders reach them.
        </p>
      </div>
    </Card>
  )
}
