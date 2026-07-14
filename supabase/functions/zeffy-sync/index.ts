// Zeffy → Supabase sync. Paste this into a Supabase Edge Function named
// "zeffy-sync" (Dashboard → Edge Functions → Deploy a new function).
// Requires the ZEFFY_API_KEY secret. The Zeffy key never leaves the server.

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const zeffyKey = Deno.env.get("ZEFFY_API_KEY");
    if (!zeffyKey) throw new Error("ZEFFY_API_KEY secret is not set");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let startingAfter: string | null = null;
    let synced = 0;

    // Full resync each run — team-sized volumes, well under rate limits.
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
