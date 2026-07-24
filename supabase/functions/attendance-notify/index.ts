// Attendance Slack notifications. Deploy as edge function "attendance-notify".
// Modes (POST body { kind }):
//   announce  { practice_date }  -> post the "check in / excuse" prompt to #attendance
//   recap     { session_id }     -> post the post-practice recap to #attendance
//   cron      (from pg_cron)      -> window-close reminder (channel) + board
//                                    summary (DM editors) for announced practices
// Needs SLACK_BOT_TOKEN and settings.slackAttendanceChannel (bot invited).

import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ = "America/Chicago";
const APP_URL = "https://menonrishi5.github.io/talaash/";
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const minLabel = (min: number) => {
  let h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const mer = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, "0")} ${mer}` : `${h} ${mer}`;
};
const fmtDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function tzOffsetMin(at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(at).find((p) => p.type === "timeZoneName")!.value;
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
}
// Chicago wall time (date + minutes) -> real Date.
function chicago(dateISO: string, minutes: number): Date {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60));
  return new Date(guess.getTime() - tzOffsetMin(guess) * 60000);
}
const dayOf = (iso: string) => (new Date(iso + "T00:00:00").getUTCDay() + 6) % 7; // Mon=0

async function slack(method: string, params: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SLACK_BOT_TOKEN")}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });
  return await res.json();
}

Deno.serve(async (req) => {
  try {
    if (!Deno.env.get("SLACK_BOT_TOKEN")) throw new Error("SLACK_BOT_TOKEN not set");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const kind = body.kind ?? "cron";

    const { data: stateRows } = await supabase
      .from("app_state").select("key,data").in("key", ["roster", "benching", "settings"]);
    const get = (k: string) => stateRows?.find((r) => r.key === k)?.data;
    const roster = (get("roster") ?? []) as { id: string; name: string; active?: boolean }[];
    const settings = (get("settings") ?? {}) as {
      practiceSchedule?: { day: number; startMin: number }[];
      excuseWindowHours?: number;
      slackAttendanceChannel?: string;
    };
    const location = (get("benching") ?? {})?.activeLocation as string | undefined;
    const channel = settings.slackAttendanceChannel;
    const windowH = settings.excuseWindowHours ?? 5;
    const nameOf = (id: string) => roster.find((m) => m.id === id)?.name ?? "someone";
    const startMinFor = (iso: string) =>
      settings.practiceSchedule?.find((p) => p.day === dayOf(iso))?.startMin ?? null;

    // ---- announce: prompt the channel to check in / excuse ----
    if (kind === "announce") {
      if (!channel) return json({ ok: false, error: "No attendance channel set" });
      const iso = body.practice_date as string;
      const sm = startMinFor(iso);
      const deadline = sm != null ? minLabel(sm - windowH * 60) : `${windowH}h before start`;
      const text =
        `🕺 *Practice ${fmtDate(iso)}${sm != null ? ` · ${minLabel(sm)}` : ""}*` +
        `${location ? ` · 📍 ${location}` : ""}\n` +
        `Check in when you arrive. Can't make it or running late? Fill out the excuse form ` +
        `by *${deadline}*: ${APP_URL}`;
      const r = await slack("chat.postMessage", { channel, text });
      return json({ ok: r.ok, error: r.error ?? null });
    }

    // ---- recap: after the editor ends a session ----
    if (kind === "recap") {
      if (!channel) return json({ ok: false, error: "No attendance channel set" });
      const { data: sess } = await supabase
        .from("attendance_sessions").select("*").eq("id", body.session_id).maybeSingle();
      if (!sess) return json({ ok: false, error: "Session not found" });
      const { data: cis } = await supabase.from("checkins").select("*").eq("session_id", sess.id);
      const present = (cis ?? []).filter((c) => !c.no_show);
      const fines = (cis ?? []).reduce((n, c) => n + (c.fine_pending ? 0 : Number(c.fine)), 0);
      const { data: exc } = await supabase
        .from("excuses").select("*").eq("practice_date", sess.session_date);
      const excused = (exc ?? []).filter((e) => !e.coming && e.status === "approved").length;
      const activeCount = roster.filter((m) => m.active !== false).length;
      const text =
        `📋 *Practice recap — ${fmtDate(sess.session_date)}*\n` +
        `${present.length}/${activeCount} checked in` +
        `${excused ? ` · ${excused} excused` : ""}` +
        `${fines > 0 ? ` · $${fines} in fines` : ""}.`;
      const r = await slack("chat.postMessage", { channel, text });
      return json({ ok: r.ok, error: r.error ?? null });
    }

    // ---- cron: reminders + board summaries for announced practices ----
    const { data: anns } = await supabase
      .from("attendance_announcements").select("practice_date");
    const { data: log } = await supabase
      .from("notification_log").select("occ_key,kind");
    const sent = new Set((log ?? []).map((l) => `${l.occ_key}|${l.kind}`));
    const now = new Date();
    const results: string[] = [];

    for (const a of anns ?? []) {
      const iso = a.practice_date as string;
      const sm = startMinFor(iso);
      if (sm == null) continue;
      const start = chicago(iso, sm);
      const deadline = new Date(start.getTime() - windowH * 3600000);
      const msToDeadline = deadline.getTime() - now.getTime();

      // window-closing reminder — within the last hour before the deadline
      if (channel && msToDeadline <= 60 * 60000 && msToDeadline > 0 && !sent.has(`${iso}|attn-reminder`)) {
        const r = await slack("chat.postMessage", {
          channel,
          text: `⏰ *Heads up* — the excuse window for ${fmtDate(iso)}'s practice closes in about an hour. ` +
            `If you can't make it or will be late, submit now: ${APP_URL}`,
        });
        await logOnce(supabase, iso, "attn-reminder", r.ok ? "sent" : `slack: ${r.error}`);
        results.push(`reminder ${iso}: ${r.ok}`);
      }

      // board summary — once the window has closed, DM the editors
      if (msToDeadline <= 0 && start.getTime() > now.getTime() && !sent.has(`${iso}|attn-summary`)) {
        const { data: exc } = await supabase.from("excuses").select("*").eq("practice_date", iso);
        const late = (exc ?? []).filter((e) => e.coming && e.arrival_min != null)
          .map((e) => `${nameOf(e.member_id)} @ ${minLabel(e.arrival_min)}`);
        const absent = (exc ?? []).filter((e) => !e.coming && e.status === "approved").map((e) => nameOf(e.member_id));
        const pending = (exc ?? []).filter((e) => !e.coming && e.status === "pending").map((e) => nameOf(e.member_id));
        const text =
          `🗂 *Pre-practice summary — ${fmtDate(iso)}*\n` +
          `• Arriving late: ${late.length ? late.join(", ") : "none"}\n` +
          `• Excused absences: ${absent.length ? absent.join(", ") : "none"}\n` +
          `• Pending your review: ${pending.length ? pending.join(", ") : "none"}`;
        await dmEditors(supabase, text);
        await logOnce(supabase, iso, "attn-summary", "sent");
        results.push(`summary ${iso}`);
      }
    }
    return json({ ok: true, results });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

function json(o: unknown) {
  return new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
}
async function logOnce(supabase: any, occ: string, kind: string, detail: string) {
  await supabase.from("notification_log").upsert(
    { occ_key: occ, kind, detail, sent_at: new Date().toISOString() },
    { onConflict: "occ_key,kind" },
  );
}
async function dmEditors(supabase: any, text: string) {
  const { data: editors } = await supabase
    .from("profiles").select("email,slack_email").eq("role", "editor");
  for (const e of editors ?? []) {
    const email = e.slack_email || e.email;
    if (!email) continue;
    const lu = await slack("users.lookupByEmail", { email });
    if (lu.ok) await slack("chat.postMessage", { channel: lu.user.id, text });
  }
}
