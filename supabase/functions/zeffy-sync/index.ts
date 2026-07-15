// Zeffy → Supabase sync (v2). Re-paste over the existing "zeffy-sync"
// edge function. Adds matched_member_id, computed with the same precedence
// as the app (manual link > full name > unique last name > unique first
// name), so row-level security can show viewers only their own payments.

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function buildMatcher(
  roster: { id: string; name: string }[],
  links: Record<string, string>,
) {
  const ids = new Set(roster.map((m) => m.id));
  const byFull: Record<string, string> = {};
  const byLast: Record<string, string[]> = {};
  const byFirst: Record<string, string[]> = {};
  for (const m of roster) {
    const full = norm(m.name);
    byFull[full] = m.id;
    const words = full.split(" ");
    if (words[0]) (byFirst[words[0]] = byFirst[words[0]] || []).push(m.id);
    if (words.length > 1) {
      const last = words[words.length - 1];
      (byLast[last] = byLast[last] || []).push(m.id);
    }
  }
  return (buyerFirst: unknown, buyerLast: unknown, buyerEmail: unknown) => {
    const full = norm(`${buyerFirst ?? ""} ${buyerLast ?? ""}`);
    const key = norm(buyerEmail) || full;
    const linked = links[key];
    if (linked && ids.has(linked)) return linked;
    if (byFull[full]) return byFull[full];
    const last = buyerLast
      ? norm(buyerLast).split(" ").pop()!
      : full.includes(" ") ? full.split(" ").pop()! : "";
    const lastHits = byLast[last] ?? [];
    if (lastHits.length === 1) return lastHits[0];
    const first = norm(buyerFirst).split(" ")[0] || full.split(" ")[0];
    const firstHits = byFirst[first] ?? [];
    if (firstHits.length === 1) return firstHits[0];
    return null;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const zeffyKey = Deno.env.get("ZEFFY_API_KEY");
    if (!zeffyKey) throw new Error("ZEFFY_API_KEY secret is not set");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Roster + manual buyer links, for server-side member matching.
    const { data: stateRows } = await supabase
      .from("app_state")
      .select("key,data")
      .in("key", ["roster", "dues"]);
    const roster = (stateRows?.find((r) => r.key === "roster")?.data ??
      []) as { id: string; name: string }[];
    const links = ((stateRows?.find((r) => r.key === "dues")?.data as
      | { contactLinks?: Record<string, string> }
      | undefined)?.contactLinks ?? {});
    const match = buildMatcher(roster, links);

    let startingAfter: string | null = null;
    let synced = 0;

    for (let page = 0; page < 50; page++) {
      const url = new URL("https://api.zeffy.com/api/v1/payments");
      url.searchParams.set("limit", "100");
      if (startingAfter) url.searchParams.set("starting_after", startingAfter);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${zeffyKey}` },
      });
      if (!res.ok) {
        throw new Error(
          `Zeffy API ${res.status}: ${(await res.text()).slice(0, 300)}`,
        );
      }
      const body = await res.json();
      const payments = body.data ?? [];
      if (payments.length === 0) break;

      const rows = payments.map((p: Record<string, unknown>) => {
        const buyer = (p.buyer ?? {}) as Record<string, unknown>;
        return {
          id: p.id,
          created: new Date(((p.created as number) ?? 0) * 1000).toISOString(),
          amount_cents: (p.amount as number) ?? 0,
          currency: p.currency ?? null,
          status: p.status ?? null,
          type: p.type ?? null,
          refund_status: p.refund_status ?? null,
          description: p.description ?? null,
          campaign_id: p.campaign_id ?? null,
          buyer_email: buyer.email ?? null,
          buyer_first: buyer.first_name ?? null,
          buyer_last: buyer.last_name ?? null,
          matched_member_id: match(buyer.first_name, buyer.last_name, buyer.email),
          items: p.items ?? [],
          raw: p,
          synced_at: new Date().toISOString(),
        };
      });

      const { error } = await supabase.from("zeffy_payments").upsert(rows);
      if (error) throw error;
      synced += rows.length;
      startingAfter = payments[payments.length - 1].id;
      if (!body.has_more) break;
    }

    return new Response(JSON.stringify({ ok: true, synced }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
