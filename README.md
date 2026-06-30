# Visa Medical Platform

Two tools in one app: an interactive **Centre Map** of visa medical centres, and a
**Test Requirements** matrix of the medical tests each destination requires.

The map covers visa medical centres across source countries, with
filters for visa programme (Australia, UK, Canada, USA, NZ, South Korea, Japan,
Malaysia, WAFID), status (Active / New / De-panelled), and a WAFID
source-country demand layer.

Live site: deployed on Vercel. Data lives in a GitHub Gist read at request time.

## Two views

The app has two top-level views, switched from the top bar:

- **Centre Map** — the interactive map + rail (filters, insights, country, update,
  WAFID demand, changes). This is the original platform.
- **Test Requirements** — the medical-test matrix across 5 destinations
  (Australia, NZ, Malaysia, GCC/WAFID, Abu Dhabi): which tests each requires, in a
  table or heatmap, with per-test operational/cost notes. Ported from the former
  standalone "Country-Wise Medical Test Requirements" dashboard.

The two views are **linked by destination**:
- In the **Centre Map**, a dedicated **Test** rail tab shows a compact "🧪 Test
  requirements" card for a chosen destination (Australia / NZ / Malaysia / WAFID /
  Abu Dhabi) — required tests grouped by type, with a button to filter the map to that
  programme's centres. Each test-covered programme in the Visa Programme filter also
  has a 🧪 shortcut to it. (The rail tab bar is a 4-column grid, so all 8 tabs sit in
  two rows.)
- In the **Test Requirements** matrix, selecting a destination shows a
  "View N centres empanelled for [X] →" bar that jumps to the map filtered to that
  programme. (Abu Dhabi's tests roll up to the WAFID centres.)

Both views live in the one `public/index.html`. See `CLAUDE.md` for how the Test
Requirements view is isolated (`#viewTests` / `window.MT`) and linked
(`DEST_TAXONOMY` / `window.VMP`).

## Folder layout

```
.
├── public/        Files served to the browser. Edit index.html for UI/behaviour.
├── server/        Node/Express API. Reads data from Gist (prod) or data/ (dev).
├── data/          Source of truth for centres + WAFID demand. Pushed to the Gist.
├── scripts/       start.bat (run locally) and push-to-gist.ps1 (deploy data).
├── reference/     Source documents (FOMEMA/WAFID/Abu Dhabi PDFs, Malaysia PNGs,
│                  IME readiness .xlsx) + archived original dashboard. NOT served.
├── package.json   Express dep + npm start.
├── vercel.json    Build/route config for Vercel.
├── CHANGELOG.md   Dated record of data and feature changes.
└── CLAUDE.md      Repo guide for AI assistants (Claude Code etc.).
```

## Run locally

```powershell
# easiest — double-click scripts/start.bat
# or:
npm install
npm start
# then open http://localhost:3000
```

Local mode reads `data/data.json` directly from disk. No Gist access is needed.

## Deploying changes

Two independent moving parts:

### Code (HTML / server.js) — Git push → Vercel auto-deploys
```powershell
git add public/index.html server/api.js
git commit -m "..."
git push
```

### Data (centres + WAFID demand) — push to the Gist
The deployed Vercel server reads data from a private GitHub Gist at request time,
so a Git push alone does NOT update data. Use the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\push-to-gist.ps1 -GistId "<id>" -Token "<token>"
```

The Gist ID and a fine-grained PAT live in **Vercel → Settings → Environment
Variables** as `GIST_ID` and `GITHUB_TOKEN`. Never commit either.

## Editing the data

`data/data.json` is the single file the API serves. The `centres` array drives
the map; `wafidDemand.cities` drives the Demand layer; `cityConcentration` is a
derived cache (rebuild whenever centres change — see `CHANGELOG.md` for prior
examples). `data/data-snapshot.json` is the baseline that the in-app
"Revert to Baseline" button restores from.

Append a one-line entry to `CHANGELOG.md` whenever you touch data — future you
will thank present you.
