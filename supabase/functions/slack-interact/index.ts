// Slack interactivity endpoint — handles the "✅ I've got it" / "↪️ Pass to my
// reserve" buttons on the benching reminder DMs sent by benching-notify.
//
// Deploy as edge function "slack-interact" with "Verify JWT" turned OFF
// (Slack doesn't send a Supabase token — requests are authenticated by
// Slack's signing-secret signature instead). Then in the Slack app:
//   Interactivity & Shortcuts -> On -> Request URL:
//   https://rsltynrrehmpaarzwpew.supabase.co/functions/v1/slack-interact
// Needs secrets SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET (Slack app ->
// Basic Information -> App Credentials -> Signing Secret).

import { createClient } from "jsr:@supabase/supabase-js@2";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const enc = new TextEncoder();

const minLabel = (min: number) => {
  let h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const mer = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, "0")} ${mer}` : `${h} ${mer}`;
};

// Slack signs every request: v0=HMAC_SHA256(secret, "v0:{ts}:{rawBody}").
async function verifySlack(req: Request, raw: string): Promise<boolean> {
  const secret = Deno.env.get("SLACK_SIGNING_SECRET");
  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!secret || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay guard
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`v0:${ts}:${raw}`));
  const expected = "v0=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function slackUserEmail(userId: string): Promise<string | null> {
  const body = new URLSearchParams({ user: userId });
  const res = await fetch("https://slack.com/api/users.info", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SLACK_BOT_TOKEN")}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: body.toString(),
  });
  const j = await res.json();
  return j.ok ? ((j.user?.profile?.email as string | undefined)?.toLowerCase() ?? null) : null;
}

// Post a follow-up through the interaction's response_url: replace the
// original message (buttons -> confirmation) or send a private note.
async function reply(responseUrl: string, text: string, replaceOriginal: boolean) {
  const payload = replaceOriginal
    ? { replace_original: true, text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] }
    : { response_type: "ephemeral", replace_original: false, text };
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  if (!(await verifySlack(req, raw))) return new Response("invalid signature", { status: 401 });

  const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}");
  if (payload.type !== "block_actions") return new Response("");
  const action = payload.actions?.[0];
  const responseUrl = payload.response_url as string | undefined;
  // "Other options" is a link button; Slack still pings us, nothing to do.
  if (!action || !responseUrl || !["bench_ack", "bench_pass"].includes(action.action_id)) {
    return new Response("");
  }

  try {
    const [week, slotId, role, memberId] = String(action.value ?? "").split("|");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // The button was minted for one member; make sure the person tapping it
    // is that member (matched by Slack email against their profile).
    const { data: prof } = await supabase
      .from("profiles").select("email,slack_email").eq("member_id", memberId);
    const allowed = new Set(
      (prof ?? []).flatMap((p) => [p.email, p.slack_email]).filter(Boolean).map((e) => String(e).toLowerCase()),
    );
    const clickerEmail = await slackUserEmail(payload.user?.id);
    if (!clickerEmail || !allowed.has(clickerEmail)) {
      await reply(responseUrl, "This button isn't yours — it's for the person it was sent to.", false);
      return new Response("");
    }

    const { data: stateRows } = await supabase
      .from("app_state").select("key,data").in("key", ["roster", "benching"]);
    const roster = (stateRows?.find((r) => r.key === "roster")?.data ?? []) as { id: string; name: string }[];
    const benching = (stateRows?.find((r) => r.key === "benching")?.data ?? {}) as {
      template?: { id: string; day: number; startMin: number; endMin: number; memberId: string; reserveId: string | null }[];
      activeLocation?: string | null;
    };
    const slot = (benching.template ?? []).find((s) => s.id === slotId);
    if (!slot) {
      await reply(responseUrl, "That slot no longer exists — the schedule changed.", true);
      return new Response("");
    }
    if (role === "primary" ? slot.memberId !== memberId : slot.reserveId !== memberId) {
      await reply(responseUrl, "That slot has been reassigned — check Talaash HQ for the current schedule.", true);
      return new Response("");
    }
    const when = `${DAY_NAMES[slot.day]} ${minLabel(slot.startMin)}–${minLabel(slot.endMin)}` +
      (benching.activeLocation ? ` at ${benching.activeLocation}` : "");

    const { data: existing } = await supabase
      .from("slot_responses").select("*").eq("week_iso", week).eq("slot_id", slotId).maybeSingle();

    if (action.action_id === "bench_ack") {
      if (role === "primary") {
        if (existing?.status === "declined") {
          await reply(responseUrl, "That slot was already passed to your reserve — check Talaash HQ if that's wrong.", true);
          return new Response("");
        }
        const { error } = await supabase.from("slot_responses").upsert(
          { week_iso: week, slot_id: slotId, member_id: slot.memberId, status: "accepted", responded_at: new Date().toISOString() },
          { onConflict: "week_iso,slot_id" },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase.from("slot_responses").upsert(
          {
            week_iso: week, slot_id: slotId, member_id: slot.memberId,
            // Don't downgrade an existing primary row; 'pending' is only the
            // placeholder used when the reserve answers first.
            status: existing?.status ?? "pending",
            reserve_status: "accepted", reserve_responded_at: new Date().toISOString(),
          },
          { onConflict: "week_iso,slot_id" },
        );
        if (error) throw error;
      }
      await reply(responseUrl, `✅ Thanks — you're confirmed for benching ${when}. See you there!`, true);
    } else {
      // bench_pass: primary hands the slot to their reserve.
      if (role !== "primary" || !slot.reserveId) {
        await reply(responseUrl, "There's no reserve to pass this to — use Talaash HQ for other options.", false);
        return new Response("");
      }
      const { error } = await supabase.from("slot_responses").upsert(
        { week_iso: week, slot_id: slotId, member_id: slot.memberId, status: "declined", responded_at: new Date().toISOString() },
        { onConflict: "week_iso,slot_id" },
      );
      if (error) throw error;
      const reserveName = roster.find((m) => m.id === slot.reserveId)?.name ?? "your reserve";
      await reply(responseUrl, `↪️ Passed benching ${when} to ${reserveName} — they'll get a DM shortly.`, true);
    }
  } catch (e) {
    console.error("slack-interact failed", e);
    await reply(responseUrl, "Something went wrong saving that — please use Talaash HQ instead.", false);
  }
  return new Response("");
});
