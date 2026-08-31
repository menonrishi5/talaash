import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase } from '../supabase.js'
import { isActive } from '../matching.js'
import { Button, Card, CardHeader, TextInput, EmptyState, Badge, Select, PageHeader } from './ui.jsx'

export default function Roster() {
  const { state, addMember, renameMember, removeMember, setMemberActive, setMemberPaymentPlan } = useStore()
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
      <PageHeader
        title="Team Roster"
        subtitle="Everyone here is selectable in segments, benching, and attendance."
      />

      <div className="space-y-5">
        <Card>
          <CardHeader
            title={`Members (${state.roster.length})`}
            subtitle={`${state.roster.filter(isActive).length} active · ${state.roster.filter((m) => !isActive(m)).length} inactive. Inactive members can't be placed on benching, segments, or check in.`}
          />
          <div className="px-5 pb-5">
            {canEdit && (
              <div className="flex flex-col gap-2 mb-4 sm:flex-row">
                <TextInput
                  placeholder="Add a member…"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && add()}
                />
                <Button variant="primary" onClick={add} className="sm:w-auto w-full">Add</Button>
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
              <ul className="divide-y divide-line">
                {state.roster.map((m) => (
                  <li key={m.id} className={`flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3 ${isActive(m) ? '' : 'opacity-60'}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-subtle text-muted flex items-center justify-center text-xs font-semibold shrink-0">
                        {m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      {/* name + badges — flexible, truncates before touching the actions */}
                      <div className="flex-1 min-w-0 flex items-center gap-2">
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
                          <span className="text-sm font-medium text-ink truncate">{m.name}</span>
                        )}
                        {!isActive(m) && <Badge className="bg-warn-soft text-warn shrink-0">inactive</Badge>}
                        {m.paymentPlan && <Badge className="bg-info-soft text-info shrink-0" title="Exempt from late-payment fines">payment plan</Badge>}
                        {segCount[m.id] ? (
                          <Badge className="bg-subtle text-muted shrink-0">{segCount[m.id]} seg{segCount[m.id] > 1 ? 's' : ''}</Badge>
                        ) : null}
                      </div>
                    </div>
                    {/* actions — wrap under the name on phones, fixed-width columns on desktop */}
                    {canEdit && (
                      <div className="flex flex-wrap items-center gap-1 shrink-0 pl-11 sm:pl-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="sm:w-28"
                          onClick={() => setMemberPaymentPlan(m.id, !m.paymentPlan)}
                          title={m.paymentPlan ? 'Remove payment-plan exemption' : 'On a payment plan — exempt from late-payment fines'}
                        >
                          {m.paymentPlan ? 'End plan' : 'Payment plan'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="sm:w-24"
                          onClick={() => setMemberActive(m.id, !isActive(m))}
                          title={isActive(m) ? 'Mark inactive — removed from pickers, kept in history' : 'Mark active again'}
                        >
                          {isActive(m) ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button size="sm" variant="ghost" className="sm:w-20" onClick={() => setEditing(m.id)}>Rename</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="sm:w-20 text-bad hover:text-bad"
                          onClick={async () => {
                            // Members with financial history must be deactivated, not
                            // deleted — deleting orphans their fines and payments.
                            const [c1, c2, c3] = await Promise.all([
                              supabase.from('checkins').select('id', { count: 'exact', head: true }).eq('member_id', m.id),
                              supabase.from('payments').select('id', { count: 'exact', head: true }).eq('member_id', m.id),
                              supabase.from('reimbursements').select('id', { count: 'exact', head: true }).eq('member_id', m.id),
                            ])
                            const n = (c1.count ?? 0) + (c2.count ?? 0) + (c3.count ?? 0)
                            if (n > 0) {
                              alert(`${m.name} has ${n} financial record${n > 1 ? 's' : ''} (fines, payments, or reimbursements). Deactivate them instead so their money history stays visible.`)
                              return
                            }
                            if (confirm(`Remove ${m.name} from the roster? They'll be pulled from all segments.`))
                              removeMember(m.id)
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {canEdit && <TeamAccess />}
      </div>
    </div>
  )
}

// App accounts and their roles. Editors can promote/demote; role changes are
// enforced by the database, this UI just edits the profiles table.
function TeamAccess() {
  const { canEdit, session, isOwner } = useAuth()
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
        subtitle={
          isOwner
            ? 'Accounts, their role, and which member each is. As the owner, you’re the only one who can grant or revoke admin (editor) access.'
            : 'Accounts, their role, and which member each is. Admin (editor) access is granted by the owner only.'
        }
      />
      <div className="px-5 pb-5">
        {error && <p className="text-sm text-bad mb-2">{error}</p>}
        {!profiles ? (
          <p className="text-sm text-faint">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="text-sm text-faint italic">No accounts yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {profiles.map((p) => {
              const member = state.roster.find((m) => m.id === p.member_id)
              return (
                <li key={p.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="flex-1 min-w-0 text-sm text-ink truncate">
                    {p.email}
                    {p.id === session?.user?.id && <span className="text-faint"> (you)</span>}
                  </span>
                  <div className="w-full shrink-0 sm:w-44">
                    {canEdit ? (
                      <Select
                        className="!w-full !py-1 !text-xs"
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
                      <Badge className="bg-subtle text-muted">{member.name}</Badge>
                    ) : (
                      <span className="text-xs text-faint">not linked</span>
                    )}
                  </div>
                  {canEdit && (
                    <input
                      type="email"
                      defaultValue={p.slack_email ?? ''}
                      placeholder="Slack email (if different)"
                      title="Set only if this person's Slack email differs from their login email, so DM reminders reach them."
                      className="w-full shrink-0 px-2 py-1 text-xs bg-surface border border-line-strong rounded-lg sm:w-52"
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v !== (p.slack_email ?? '')) update(p.id, { slack_email: v || null })
                      }}
                    />
                  )}
                  <div className="w-full shrink-0 flex justify-start sm:w-24 sm:justify-end">
                    {/* Only the owner can grant/revoke admin access. */}
                    {isOwner && p.id !== session?.user?.id ? (
                      <Select
                        className="!w-full !py-1 !text-xs"
                        value={p.role}
                        onChange={(e) => update(p.id, { role: e.target.value })}
                        title="Grant or revoke admin (editor) access"
                      >
                        <option value="viewer">viewer</option>
                        <option value="editor">editor</option>
                      </Select>
                    ) : (
                      <Badge className={p.role === 'editor' ? 'bg-good-soft text-good' : 'bg-subtle text-muted'}>
                        {p.role}
                      </Badge>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-[11px] text-faint mt-3">
          Anyone on the team can create an account from the sign-in page — they start as a viewer.
          Link each account to its roster member so members see their own dues and can accept
          benching slots. Set a Slack email only when it differs from the login email, so DM
          reminders reach them.
        </p>
      </div>
    </Card>
  )
}
