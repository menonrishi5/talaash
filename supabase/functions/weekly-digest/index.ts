// Weekly benching digest to a Slack channel. Deploy as "weekly-digest";
// migration-9 schedules it (e.g. Monday 9am). BENCHING ONLY — no money.
// Needs SLACK_BOT_TOKEN and settings.slackDigestChannel (a channel id the
// bot has been invited to).

import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ = "America/Chicago";
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function thisMondayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()).split("-");
  const noon = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 12));
  const dow = (noon.getUTCDay() + 6) % 7;
  noon.setUTCDate(noon.getUTCDate() - dow);
  return noon.toISOString().slice(0, 10);
}

const minLabel = (min: number) => {
  let h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const mer = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, "0")} ${mer}` : `${h} ${mer}`;
};

Deno.serve(async (_req) => {
  try {
    const token = Deno.env.get("SLACK_BOT_TOKEN");
    if (!token) throw new Error("SLACK_BOT_TOKEN not set");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const weekISO = thisMondayISO();
    const [{ data: stateRows }, { data: responses }] = await Promise.all([
      supabase.from("app_state").select("key,data").in("key", ["roster", "benching", "settings"]),
      supabase.from("slot_responses").select("*").eq("week_iso", weekISO),
    ]);
    const get = (k: string) => stateRows?.find((r) => r.key === k)?.data;
    const roster = (get("roster") ?? []) as { id: string; name: string }[];
    const benching = (get("benching") ?? {}) as {
      template?: { id: string; day: number; startMin: number; endMin: number; memberId: string; reserveId: string | null }[];
      weeks?: Record<string, Record<string, { status: string }>>;
      activeLocation?: string | null;
    };
    const channel = (get("settings") ?? {})?.slackDigestChannel;
    if (!channel) return new Response(JSON.stringify({ ok: false, error: "No slackDigestChannel configured" }), { status: 200 });

    const nameOf = (id: string | null) => roster.find((m) => m.id === id)?.name ?? "someone";
    const respBySlot: Record<string, string> = {};
    for (const r of responses ?? []) respBySlot[r.slot_id] = r.status;
    const weekOv = benching.weeks?.[weekISO] ?? {};

    const template = [...(benching.template ?? [])].sort((a, b) => a.day - b.day || a.startMin - b.startMin);
    const uncovered: string[] = [];
    const unaccepted: string[] = [];
    let accepted = 0;
    for (const slot of template) {
      const when = `${DAY_NAMES[slot.day]} ${minLabel(slot.startMin)}–${minLabel(slot.endMin)}`;
      if (weekOv[slot.id]?.status === "uncovered") {
        uncovered.push(`• ${when} — was ${nameOf(slot.memberId)}`);
      } else if (respBySlot[slot.id] === "accepted") {
        accepted++;
      } else if (respBySlot[slot.id] === "declined") {
        unaccepted.push(`• ${when} — ${nameOf(slot.memberId)} declined${slot.reserveId ? `, reserve ${nameOf(slot.reserveId)}` : " (no reserve!)"}`);
      } else {
        unaccepted.push(`• ${when} — ${nameOf(slot.memberId)} hasn't accepted`);
      }
    }

    let text = `*🪑 Benching this week* (${weekISO})${benching.activeLocation ? ` · 📍 ${benching.activeLocation}` : ""}\n`;
    text += `${accepted}/${template.length} slots confirmed.\n`;
    if (uncovered.length) text += `\n*⚠️ Uncovered (${uncovered.length}):*\n${uncovered.join("\n")}\n`;
    if (unaccepted.length) text += `\n*Needs attention (${unaccepted.length}):*\n${unaccepted.join("\n")}\n`;
    if (!uncovered.length && !unaccepted.length) text += `\n✅ Everything's covered — nice.`;

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text }),
    });
    const j = await res.json();
    return new Response(JSON.stringify({ ok: j.ok, error: j.error ?? null }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
