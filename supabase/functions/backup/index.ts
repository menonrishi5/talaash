// Weekly backup. Deploy as edge function "backup"; migration-9 schedules it.
// Dumps every table to a timestamped JSON file in the private "backups"
// bucket. Download from Storage → backups to restore. Runs as service role.

import { createClient } from "jsr:@supabase/supabase-js@2";

const TABLES = [
  "app_state", "attendance_sessions", "session_secrets", "checkins",
  "payments", "zeffy_payments", "reimbursements", "slot_responses",
  "venmo_transactions", "profiles", "notification_log",
];

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const dump: Record<string, unknown> = { _generated: new Date().toISOString() };
    for (const t of TABLES) {
      const { data, error } = await supabase.from(t).select("*");
      dump[t] = error ? { error: error.message } : data;
    }

    const name = `backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    const { error: upErr } = await supabase.storage
      .from("backups")
      .upload(name, JSON.stringify(dump), { contentType: "application/json", upsert: true });
    if (upErr) throw upErr;

    // Keep the most recent ~12 backups.
    const { data: files } = await supabase.storage.from("backups").list("", {
      sortBy: { column: "name", order: "desc" },
    });
    const stale = (files ?? []).slice(12).map((f) => f.name);
    if (stale.length) await supabase.storage.from("backups").remove(stale);

    return new Response(JSON.stringify({ ok: true, file: name }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
