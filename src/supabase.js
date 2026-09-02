import { createClient } from '@supabase/supabase-js'
import { teamParts } from './lib.js'

// The anon key is designed to be public (it ships to every visitor's browser);
// access control lives in the database's row-level security policies.
export const SUPABASE_URL = 'https://rsltynrrehmpaarzwpew.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzbHR5bnJyZWhtcGFhcnp3cGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MDU0MDQsImV4cCI6MjA5OTQ4MTQwNH0.GOI71nqr9XR06ycHnFvYyLG-MHcRJ_Dmz4tEd02Orlg'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Local date string (YYYY-MM-DD) in the team's timezone — practices are in Texas.
export const TEAM_TZ = 'America/Chicago'

export function todayTeamISO() {
  // Intl parts, not a locale-formatted string — see teamParts in lib.js.
  return teamParts().iso
}

export function fmtTeamTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', {
    timeZone: TEAM_TZ,
    hour: 'numeric',
    minute: '2-digit',
  })
}
