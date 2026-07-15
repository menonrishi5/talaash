// Benching notification engine. Deploy as edge function "benching-notify";
// a pg_cron job (migration-5) invokes it every 10 minutes.
//
// Sends Slack DMs for each upcoming benching slot occurrence:
//   accept-request : slot enters the 48h window, member hasn't responded
//   day-before     : ~24h out — reminder if accepted, nag if not
//   reserve-called : declined, or unaccepted past the accept deadline
//                    (settings.benchingAcceptDeadlineHours, default 12)
//   day-of         : morning of (9 AM Chicago) to whoever is on duty
//   hour-before    : ~60 min out to whoever is on duty
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

const slackIdCache = new Map<string, string | null>();
async function slackIdForEmail(email: string): Promise<string | null> {
  if (slackIdCache.has(email)) return slackIdCache.get(email)!;
  const r = await slack("users.lookupByEmail", { email });
  const id = r.ok ? r.user.id : null;
  slackIdCache.set(email, id);
  return id;
}

Deno.serve(async (_req) => {
  try {
    if (!Deno.env.get("SLACK_BOT_TOKEN")) throw new Error("SLACK_BOT_TOKEN not set");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [{ data: stateRows }, { data: profiles }, { data: responses }, { data: log }] =
      await Promise.all([
        supabase.from("app_state").select("key,data").in("key", ["roster", "benching", "settings"]),
        supabase.from("profiles").select("member_id,email").not("member_id", "is", null),
        supabase.from("slot_responses").select("*"),
        supabase.from("notification_log").select("occ_key,kind"),
      ]);

    const roster = (stateRows?.find((r) => r.key === "roster")?.data ?? []) as
      { id: string; name: string; active?: boolean }[];
    const benching = (stateRows?.find((r) => r.key === "benching")?.data ?? {}) as {
      template?: { id: string; day: number; startMin: number; endMin: number; memberId: string; reserveId: string | null }[];
      activeLocation?: string | null;
    };
    const settings = (stateRows?.find((r) => r.key === "settings")?.data ?? {}) as
      { benchingAcceptDeadlineHours?: number };
    const deadlineH = settings.benchingAcceptDeadlineHours ?? 12;

    const emailByMember: Record<string, string> = {};
    for (const p of profiles ?? []) emailByMember[p.member_id] = p.email;
    const nameOf = (id: string | null) => roster.find((m) => m.id === id)?.name ?? "someone";
    const sent = new Set((log ?? []).map((l) => `${l.occ_key}|${l.kind}`));
    const respByOcc: Record<string, { status: string }> = {};
    for (const r of responses ?? []) respByOcc[`${r.week_iso}:${r.slot_id}`] = r;

    const now = new Date();
    const appUrl = "https://menonrishi5.github.io/talaash/";
    const loc = benching.activeLocation ? ` at ${benching.activeLocation}` : "";
    const toSend: { memberId: string; occ: string; kind: string; text: string }[] = [];

    for (const wk of [weekStart(0), weekStart(1)]) {
      for (const slot of benching.template ?? []) {
        const start = chicagoDate(wk.y, wk.mo, wk.d + slot.day, slot.startMin);
        const msUntil = start.getTime() - now.getTime();
        if (msUntil < -30 * 60000 || msUntil > 49 * 3600000) continue; // past, or >49h out

        const occ = `${wk.iso}:${slot.id}`;
        const resp = respByOcc[occ];
        const accepted = resp?.status === "accepted";
        const declined = resp?.status === "declined";
        const pastDeadline = msUntil < deadlineH * 3600000;
        const reserveOn = declined || (!accepted && pastDeadline && slot.reserveId);
        const onDutyId = reserveOn ? slot.reserveId! : slot.memberId;
        const when = `${DAY_NAMES[slot.day]} ${minLabel(slot.startMin)}–${minLabel(slot.endMin)}${loc}`;

        const queue = (kind: string, memberId: string, text: string) => {
          if (!sent.has(`${occ}|${kind}`)) toSend.push({ memberId, occ, kind, text });
        };

        // accept-request: entering the 48h window, no response yet
        if (!resp && msUntil <= 48 * 3600000) {
          queue("accept-request", slot.memberId,
            `🪑 You have a benching slot ${when}. Please accept (or decline) it in Talaash HQ: ${appUrl}`);
        }
        // day-before (~24h out)
        if (msUntil <= 26 * 3600000 && msUntil > 20 * 3600000) {
          if (accepted) {
            queue("day-before", slot.memberId, `⏰ Reminder: benching tomorrow, ${when}.`);
          } else if (!declined) {
            queue("day-before", slot.memberId,
              `⚠️ You still haven't accepted your benching slot ${when}. If it's not accepted ${deadlineH}h before, your reserve gets called. ${appUrl}`);
          }
        }
        // reserve called (decline, or silent past deadline)
        if (reserveOn) {
          queue("reserve-called", slot.reserveId!,
            `🔁 You're up! ${nameOf(slot.memberId)} ${declined ? "declined" : "didn't accept"} the benching slot ${when} — you're covering as reserve.`);
          queue("reserve-passed", slot.memberId,
            `Your benching slot ${when} was passed to your reserve (${nameOf(slot.reserveId)}).`);
        }
        // day-of: after 9 AM Chicago on the slot's day
        const nineAm = chicagoDate(wk.y, wk.mo, wk.d + slot.day, 9 * 60);
        if (now >= nineAm && msUntil > 0 && (accepted || reserveOn)) {
          queue("day-of", onDutyId, `📅 Benching today: ${when}.`);
        }
        // hour-before
        if (msUntil <= 75 * 60000 && msUntil > 0 && (accepted || reserveOn)) {
          queue("hour-before", onDutyId, `🚨 Benching in about an hour: ${when}.`);
        }
      }
    }

    let delivered = 0;
    for (const n of toSend) {
      const email = emailByMember[n.memberId];
      let detail = "no linked account";
      if (email) {
        const slackId = await slackIdForEmail(email);
        if (slackId) {
          const r = await slack("chat.postMessage", { channel: slackId, text: n.text });
          detail = r.ok ? "sent" : `slack error: ${r.error}`;
          if (r.ok) delivered++;
        } else {
          detail = `no slack user for ${email}`;
        }
      }
      // Log even when undeliverable so we don't retry forever.
      await supabase.from("notification_log").upsert(
        { occ_key: n.occ, kind: n.kind, member_id: n.memberId, detail },
        { onConflict: "occ_key,kind", ignoreDuplicates: true },
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
