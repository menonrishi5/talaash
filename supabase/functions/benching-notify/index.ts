// Benching notification engine. Deploy as edge function "benching-notify";
// a pg_cron job (migration-5) invokes it every 10 minutes.
//
// Slots are on duty by default — nobody has to accept. Sends Slack DMs for
// each upcoming occurrence:
//   accept-request : slot enters the 48h window — a heads-up, not a request
//                    (kind name kept as-is so dedup keys don't churn)
//   day-before     : ~24h out — reminder to whoever's on duty
//   reserve-called : the assigned member explicitly passed it to the reserve
//   day-of         : morning of (9 AM Chicago) to whoever is on duty
//   hour-before    : ~60 min out to whoever is on duty
// None of these fire once a slot's been explicitly left unclaimed (either
// side rejected it outright, or the reserve also declined a pass-along).
// And for self-arranged cover swaps (cover_requests):
//   cover-request  : you were asked to cover a specific teammate's slot
//   cover-answered : the person you asked accepted or declined
//
// Members are reached via profiles.member_id -> account email -> Slack
// users.lookupByEmail. Needs SLACK_BOT_TOKEN (scopes: chat:write,
// users:read.email, im:write). notification_log dedupes sends.

import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ = "America/Chicago";
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ---- Chicago time helpers ----
function tzOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(at).find((p) => p.type === "timeZoneName")!.value; // e.g. GMT-05:00
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

// Chicago wall time -> real Date
function chicagoDate(y: number, mo: number, d: number, minutes: number): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60));
  return new Date(guess.getTime() - tzOffsetMinutes(guess) * 60000);
}

function chicagoToday(): { y: number; mo: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()).split("-");
  return { y: +parts[0], mo: +parts[1], d: +parts[2] };
}

// Monday (ISO date parts) of the week containing today, plus offset weeks
function weekStart(offsetWeeks: number): { y: number; mo: number; d: number; iso: string } {
  const t = chicagoToday();
  const noon = new Date(Date.UTC(t.y, t.mo - 1, t.d, 12));
  const dow = (noon.getUTCDay() + 6) % 7; // Mon=0
  noon.setUTCDate(noon.getUTCDate() - dow + offsetWeeks * 7);
  return {
    y: noon.getUTCFullYear(), mo: noon.getUTCMonth() + 1, d: noon.getUTCDate(),
    iso: noon.toISOString().slice(0, 10),
  };
}

const minLabel = (min: number) => {
  let h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const mer = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, "0")} ${mer}` : `${h} ${mer}`;
};

// ---- Slack ----
// Form-encoded, not JSON: users.lookupByEmail rejects a JSON body with
// invalid_arguments (every lookup was failing regardless of the email).
// Form-encoding works for every Slack Web API method used here.
async function slack(method: string, params: Record<string, unknown>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) body.set(k, String(v));
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SLACK_BOT_TOKEN")}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: body.toString(),
  });
  return await res.json();
}

// Cache the raw Slack error (not just null) so a systemic problem -- a bad
// token, a missing scope, rate-limiting -- is distinguishable in
// notification_log from a genuine "that email isn't in the workspace".
// Conflating the two used to log every failure as "no slack user for X",
// which looked like an email-matching problem even when it was really the
// bot token itself.
const slackLookupCache = new Map<string, { id: string | null; error: string | null }>();
async function slackIdForEmail(email: string): Promise<{ id: string | null; error: string | null }> {
  if (slackLookupCache.has(email)) return slackLookupCache.get(email)!;
  const r = await slack("users.lookupByEmail", { email });
  const result = r.ok ? { id: r.user.id as string, error: null } : { id: null, error: (r.error as string) ?? "unknown_error" };
  slackLookupCache.set(email, result);
  return result;
}

Deno.serve(async (_req) => {
  try {
    if (!Deno.env.get("SLACK_BOT_TOKEN")) throw new Error("SLACK_BOT_TOKEN not set");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [{ data: stateRows }, { data: profiles }, { data: responses }, { data: log }, { data: covers }] =
      await Promise.all([
        supabase.from("app_state").select("key,data").in("key", ["roster", "benching", "settings"]),
        supabase.from("profiles").select("member_id,email,slack_email").not("member_id", "is", null),
        supabase.from("slot_responses").select("*"),
        supabase.from("notification_log").select("occ_key,kind,detail"),
        supabase.from("cover_requests").select("*"),
      ]);

    const roster = (stateRows?.find((r) => r.key === "roster")?.data ?? []) as
      { id: string; name: string; active?: boolean }[];
    const benching = (stateRows?.find((r) => r.key === "benching")?.data ?? {}) as {
      template?: { id: string; day: number; startMin: number; endMin: number; memberId: string; reserveId: string | null; week?: "A" | "B" }[];
      activeLocation?: string | null;
      rotationAnchorISO?: string | null;
    };
    const anchor = benching.rotationAnchorISO || null;
    // A/B rotation: which letter a given Monday (YYYY-MM-DD) is, or null.
    const weekLetter = (mondayISO: string): "A" | "B" | null => {
      if (!anchor) return null;
      const a = new Date(anchor + "T00:00:00Z").getTime();
      const w = new Date(mondayISO + "T00:00:00Z").getTime();
      const weeks = Math.round((w - a) / (7 * 86400000));
      return ((weeks % 2) + 2) % 2 === 0 ? "A" : "B";
    };
    const slotsFor = (mondayISO: string) => {
      const L = weekLetter(mondayISO);
      return (benching.template ?? []).filter((s) => !L || !s.week || s.week === L);
    };
    // Prefer an explicitly-set Slack email, fall back to the login email.
    const emailByMember: Record<string, string> = {};
    for (const p of profiles ?? []) emailByMember[p.member_id] = p.slack_email || p.email;
    const nameOf = (id: string | null) => roster.find((m) => m.id === id)?.name ?? "someone";
    // Only a *successful* send suppresses a retry. Undeliverable attempts
    // (e.g. Slack email not set yet) are retried on later runs, so fixing the
    // email delivers within ~10 minutes instead of being silenced forever.
    const sent = new Set(
      (log ?? []).filter((l) => l.detail === "sent").map((l) => `${l.occ_key}|${l.kind}`),
    );
    const respByOcc: Record<string, { status: string }> = {};
    for (const r of responses ?? []) respByOcc[`${r.week_iso}:${r.slot_id}`] = r;

    const now = new Date();
    const appUrl = "https://talaash-five.vercel.app/";
    const loc = benching.activeLocation ? ` at ${benching.activeLocation}` : "";
    const toSend: { memberId: string; occ: string; kind: string; text: string }[] = [];

    for (const wk of [weekStart(0), weekStart(1)]) {
      for (const slot of slotsFor(wk.iso)) {
        const start = chicagoDate(wk.y, wk.mo, wk.d + slot.day, slot.startMin);
        const msUntil = start.getTime() - now.getTime();
        if (msUntil < -30 * 60000 || msUntil > 49 * 3600000) continue; // past, or >49h out

        const occ = `${wk.iso}:${slot.id}`;
        const resp = respByOcc[occ];
        // On duty by default — nobody has to accept. "declined" means the
        // assigned member explicitly passed it to the reserve; from there
        // the reserve is on duty by default too, unless either side used
        // "leave unclaimed" (which sets both status and reserve_status to
        // declined in one step) or there's no reserve to pass to.
        const passed = resp?.status === "declined";
        const reserveRejected = (resp as { reserve_status?: string } | undefined)?.reserve_status === "declined";
        const uncovered = passed && (reserveRejected || !slot.reserveId);
        const reserveOn = passed && !uncovered;
        const onDutyId = reserveOn ? slot.reserveId! : slot.memberId;
        const when = `${DAY_NAMES[slot.day]} ${minLabel(slot.startMin)}–${minLabel(slot.endMin)}${loc}`;

        const queue = (kind: string, memberId: string, text: string) => {
          if (!sent.has(`${occ}|${kind}`)) toSend.push({ memberId, occ, kind, text });
        };

        // heads-up: entering the 48h window — a plain notice, not a request
        // to accept. Kept as "accept-request" so dedup keys don't churn.
        if (!passed && msUntil <= 48 * 3600000) {
          queue("accept-request", slot.memberId,
            `🪑 You're on benching duty ${when}. No action needed unless you can't make it — you can pass it to your reserve, arrange a specific cover, or leave it unclaimed in Talaash HQ: ${appUrl}`);
        }
        // day-before (~24h out) — a reminder to whoever's on duty, unless
        // the slot's been left fully unclaimed.
        if (msUntil <= 26 * 3600000 && msUntil > 20 * 3600000 && !uncovered) {
          queue("day-before", onDutyId, `⏰ Reminder: benching tomorrow, ${when}.`);
        }
        // reserve on duty — the assigned member explicitly passed it along
        if (reserveOn) {
          queue("reserve-called", slot.reserveId!,
            `🔁 ${nameOf(slot.memberId)} passed you their benching slot ${when} — you're covering it now.`);
          queue("reserve-passed", slot.memberId,
            `Your benching slot ${when} was passed to your reserve (${nameOf(slot.reserveId)}).`);
        }
        // day-of: after 9 AM Chicago on the slot's day
        const nineAm = chicagoDate(wk.y, wk.mo, wk.d + slot.day, 9 * 60);
        if (now >= nineAm && msUntil > 0 && !uncovered) {
          queue("day-of", onDutyId, `📅 Benching today: ${when}.`);
        }
        // hour-before
        if (msUntil <= 75 * 60000 && msUntil > 0 && !uncovered) {
          queue("hour-before", onDutyId, `🚨 Benching in about an hour: ${when}.`);
        }
      }
    }

    // ---- self-arranged cover swaps (cover_requests) ----
    // DM the person asked when a request is opened, and the asker when it's
    // answered. A 3-day recency guard keeps a first run after deploy from
    // firing on old, already-settled requests.
    const tmplById = new Map((benching.template ?? []).map((s) => [s.id, s]));
    const recent = (ts: string | null) =>
      ts != null && now.getTime() - new Date(ts).getTime() < 3 * 86400000;
    for (const cr of covers ?? []) {
      const slot = tmplById.get(cr.slot_id);
      if (!slot) continue;
      const when = `${DAY_NAMES[slot.day]} ${minLabel(slot.startMin)}–${minLabel(slot.endMin)}${loc}`;
      const occ = `cover:${cr.id}`;
      if (cr.status === "pending" && recent(cr.created_at) && !sent.has(`${occ}|cover-request`)) {
        toSend.push({
          memberId: cr.to_member_id, occ, kind: "cover-request",
          text: `🔁 ${nameOf(cr.from_member_id)} asked you to cover their benching slot ${when}. ` +
            `Accept or decline in Talaash HQ: ${appUrl}`,
        });
      }
      if (
        (cr.status === "accepted" || cr.status === "declined") &&
        recent(cr.decided_at) && !sent.has(`${occ}|cover-answered`)
      ) {
        toSend.push({
          memberId: cr.from_member_id, occ, kind: "cover-answered",
          text: cr.status === "accepted"
            ? `✅ ${nameOf(cr.to_member_id)} accepted your benching cover for ${when} — the slot and its hours are theirs now.`
            : `❌ ${nameOf(cr.to_member_id)} can't cover your benching slot ${when} — you'll need another plan.`,
        });
      }
    }

    let delivered = 0;
    for (const n of toSend) {
      const email = emailByMember[n.memberId];
      let detail = "no linked account";
      if (email) {
        const { id: slackId, error: lookupError } = await slackIdForEmail(email);
        if (slackId) {
          const r = await slack("chat.postMessage", { channel: slackId, text: n.text });
          detail = r.ok ? "sent" : `slack error: ${r.error}`;
          if (r.ok) delivered++;
        } else {
          detail = lookupError === "users_not_found"
            ? `no slack user for ${email}`
            : `slack lookup failed for ${email}: ${lookupError}`;
        }
      }
      // Upsert (updating detail on conflict) so a later success flips an
      // earlier failure to "sent" and stops the retries.
      await supabase.from("notification_log").upsert(
        { occ_key: n.occ, kind: n.kind, member_id: n.memberId, detail, sent_at: new Date().toISOString() },
        { onConflict: "occ_key,kind" },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, considered: toSend.length, delivered }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
