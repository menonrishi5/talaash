# Talaash HQ

Team manager for a DDN dance team — set design, practice scheduling, and benching coordination in one app.

## Features

- **Set Design** — orderable show lineup of renameable segments. Each segment holds an ArrangeUs forms PDF (scrollable viewer), an audio mix with status (structure / draft / near-finished / finished), a cast picker with entry/exit stage sides, automatic quick-change warnings between back-to-back segments, and production notes.
- **Practice Calendar** — weekly Google-Calendar-style grid; drag a time range to schedule a segment. Tracker shows last practiced, total hours, sessions, and upcoming blocks per segment (hours count once the scheduled time passes).
- **Benching** — practice-location picker, weekly benching template imported from a sheet (`Day, Start, End, Member, Reserve`) or built in-app. Per week: confirm attendance, swap to the reserve, assign a manual cover, or flag a slot uncovered (red warning banner). Hour tracker totals normal / reserve / cover hours per member against a configurable requirement (default 15h).
- **Roster** — shared member list used by all modules.

## Stack

- React 19 + Vite 7, Tailwind CSS 4
- Persistence (current): `localStorage` for app state, IndexedDB for uploaded files — everything stays on this device
- Persistence (planned): Firebase — Firestore for state, Cloud Storage for PDFs/audio, Auth for roles. `src/store.jsx` and `src/fileStore.js` are the two seams to swap.

## Development

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # production build in dist/
```
