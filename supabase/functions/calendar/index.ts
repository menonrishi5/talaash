// Personal .ics calendar feed. Deploy as edge function "calendar".
// URL: /functions/v1/calendar?token=<profiles.calendar_token>
// Returns practice blocks (team-wide) + the member's benching slots for the
// next 8 weeks, so Google/Apple Calendar can subscribe. The token is the only
// gate — unguessable, and it exposes only that member's schedule.

import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ = "America/Chicago";
const DAY_MS = 86400000;

function tzOffsetMin(at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(at).find((p) => p.type === "timeZoneName")!.value;
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

// Chicago wall-clock (date parts + minutes-since-midnight) -> UTC stamp for ICS.
function icsStamp(y: number, mo: number, d: number, minutes: number): string {
  const guess = new Date(Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60));
  const utc = new Date(guess.getTime() - tzOffsetMin(guess) * 60000);
  return utc.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const esc = (s: string) => String(s ?? "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function mondayOf(offsetWeeks: number): { y: number; mo: number; d: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now).split("-");
  const noon = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 12));
  const dow = (noon.getUTCDay() + 6) % 7;
  noon.setUTCDate(noon.getUTCDate() - dow + offsetWeeks * 7);
  return { y: noon.getUTCFullYear(), mo: noon.getUTCMonth() + 1, d: noon.getUTCDate() };
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: profile } = await supabase
    .from("profiles").select("member_id").eq("calendar_token", token).maybeSingle();
  if (!profile) return new Response("Invalid token", { status: 404 });
  const memberId = profile.member_id;

  const { data: stateRows } = await supabase
    .from("app_state").select("key,data").in("key", ["segments", "practiceBlocks", "benching"]);
  const get = (k: string) => stateRows?.find((r) => r.key === k)?.data;
  const segments = (get("segments") ?? []) as { id: string; name: string }[];
  const blocks = (get("practiceBlocks") ?? []) as
    { id: string; segmentId: string; date: string; startMin: number; endMin: number }[];
  const benching = (get("benching") ?? {}) as {
    template?: { id: string; day: number; startMin: number; endMin: number; memberId: string; reserveId: string | null }[];
    activeLocation?: string | null;
  };
  const segName = (id: string) => segments.find((s) => s.id === id)?.name ?? "Practice";

  const lines: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Talaash HQ//EN",
    "CALSCALE:GREGORIAN", "X-WR-CALNAME:Talaash", "METHOD:PUBLISH",
  ];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ev = (uid: string, s: string, e: string, summary: string, loc?: string) => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@talaash`, `DTSTAMP:${stamp}`,
      `DTSTART:${s}`, `DTEND:${e}`, `SUMMARY:${esc(summary)}`);
    if (loc) lines.push(`LOCATION:${esc(loc)}`);
    lines.push("END:VEVENT");
  };

  // Practice blocks (team-wide).
  for (const b of blocks) {
    const [y, mo, d] = b.date.split("-").map(Number);
    ev(`practice-${b.id}`, icsStamp(y, mo, d, b.startMin), icsStamp(y, mo, d, b.endMin),
      `Practice: ${segName(b.segmentId)}`);
  }

  // This member's benching slots, next 8 weeks.
  if (memberId) {
    for (let w = 0; w < 8; w++) {
      const mon = mondayOf(w);
      for (const slot of benching.template ?? []) {
        const isPrimary = slot.memberId === memberId;
        const isReserve = slot.reserveId === memberId;
        if (!isPrimary && !isReserve) continue;
        const base = new Date(Date.UTC(mon.y, mon.mo - 1, mon.d + slot.day, 12));
        const y = base.getUTCFullYear(), mo = base.getUTCMonth() + 1, d = base.getUTCDate();
        ev(`bench-${slot.id}-w${w}`,
          icsStamp(y, mo, d, slot.startMin), icsStamp(y, mo, d, slot.endMin),
          isPrimary ? "Benching (you)" : "Benching (reserve)",
          benching.activeLocation ?? undefined);
      }
    }
  }

  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="talaash.ics"',
      "Cache-Control": "max-age=3600",
    },
  });
});
