# Talaash HQ

Team manager app for Rishi's DDN dance team (Talaash) — set design, practice scheduling, benching/attendance, and dues in one app. React 19 + Vite 7 + Tailwind 4, backed by Supabase. Deployed on Vercel: https://talaash-five.vercel.app/ (also mirrored on GitHub Pages). Repo: `menonrishi5/talaash`, `master` branch.

Note: README.md is stale — it describes an early localStorage/planned-Firebase version. Supabase has been the real backend since early on; treat this file as current, the README as historical.

## Stack & backend
- Backend: **Supabase** (not Firebase). Project `rsltynrrehmpaarzwpew`, us-west-2. Anon key is hardcoded in `src/supabase.js` (public by design).
- Data model: `app_state` table holds JSON docs per domain (set design, benching, settings, etc). Attendance uses real relational tables + a `check_in()` RPC (server clock, America/Chicago).
- Schema lives in `supabase/schema.sql` + numbered migration files. **Migrations must be run manually by Rishi in the Supabase SQL editor** — Claude cannot run DDL with the anon key. Always confirm a migration was actually applied (check column existence via REST) rather than assuming.
- Auth: email/password, `profiles` table with viewer/editor roles via RLS. Rishi's emails (`menonrishi5@gmail.com`, `rishimenon@utexas.edu`) auto-bootstrap as editor. Only Rishi (owner) can change roles (DB-enforced).
- Notifications: Slack (not web push), via Supabase Edge Functions + `pg_cron`.
- Payments: Zeffy (payments/dues) + Venmo (CSV import, no public API exists).

## Confirmed product decisions (don't re-litigate)
- No separate member login tier beyond viewer/editor — single admin-style app.
- Benching threshold counts ALL covered hours (normal + reserve + manual cover) toward the requirement (default 15h).
- Practice hours count once scheduled block time passes — no confirmation step.
- Attendance is ASSUMED (members never confirm "I'm coming"); they only submit an excuse (late/absent) if something's wrong.
- Stage sides are entered manually per member per segment — parsing ArrangeUs PDFs directly was ruled out (no public API); PDF upload + manual entry is the real workflow, with a best-effort PDF text-layer auto-detect assist.
- Fines: unpaid dues are never fined — only late PAYERS are fined, per Rishi's explicit rule.
- UI: full light/dark/system theme via semantic CSS tokens in `src/index.css` + Tailwind `@theme inline`. Never reintroduce hardcoded `bg-white`/`bg-zinc-*`/`text-zinc-*` — use the tokens.

## Environment quirks (this machine)
- Node PATH: the harness's default shell doesn't have Node on PATH. Prefix commands with `$env:Path = 'C:\Program Files\nodejs;' + $env:Path`, or use the Bash tool (has Node on PATH). `.claude/launch.json` uses the full `node.exe` path for the same reason.
- Browser-pane screenshots time out on this machine (pane not compositing) — verify UI via `read_page` / `get_page_text` / `javascript_tool` instead of screenshots.
- Git identity for this repo: "Rishi Menon" <menonrishi5@gmail.com>. Remote is `menonrishi5/talaash` on GitHub.

## Where to look for deeper history
Full build history, every migration's purpose, and all confirmed feature-level decisions are tracked in Claude's memory (`talaash-hq-project` memory file) — this doc is the portable summary of that. If working from a fresh machine/session without that memory, ask Rishi before assuming undocumented behavior is intentional.
