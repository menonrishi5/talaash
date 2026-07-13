import { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { Button, Card, CardHeader, TextInput, EmptyState, Badge } from './ui.jsx'

export default function Roster() {
  const { state, addMember, renameMember, removeMember } = useStore()
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
        Everyone here is selectable in segments and the benching scheduler.
      </p>

      <Card className="max-w-2xl">
        <CardHeader title={`Members (${state.roster.length})`} />
        <div className="px-5 pb-5">
          <div className="flex gap-2 mb-4">
            <TextInput
              placeholder="Add a member…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <Button variant="primary" onClick={add}>Add</Button>
          </div>

          {state.roster.length === 0 ? (
            <EmptyState
              icon={<span className="text-lg">👥</span>}
              title="No members yet"
              hint="Add your team above, or paste a benching sheet in the Benching tab — unknown names are added automatically."
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {state.roster.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
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
                  {segCount[m.id] ? (
                    <Badge className="bg-zinc-100 text-zinc-600">{segCount[m.id]} segment{segCount[m.id] > 1 ? 's' : ''}</Badge>
                  ) : null}
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
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  )
}
