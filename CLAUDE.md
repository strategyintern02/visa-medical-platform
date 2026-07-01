# Repo guide for Claude

This file exists so an AI assistant (Claude Code, etc.) can get oriented in this
repo without re-deriving everything from scratch.

## What this app is

Internal strategy/analytics tool that visualises visa medical centres across
several source countries, filtered by destination visa programme. A single dev
maintains it. Used by the dev + their manager + occasional stakeholders. Not
public-facing.

As of 2026-06-29 it has **two top-level views** (top-bar switcher): the original
**Centre Map**, and a **Test Requirements** matrix folded in from a formerly
standalone dashboard. See "The two views" below before editing either.

## Tech stack (kept deliberately small)

- Backend: Node + Express in `server/api.js`. Single file. No framework on top.
- Frontend: ONE HTML file (`public/index.html`) with inline CSS + inline JS. No
  bundler, no build step. Leaflet + Leaflet.markercluster + Leaflet.heat + xlsx
  are loaded from CDN.
- Data: two JSON files in `data/`. The live `data.json`; `data-snapshot.json` is
  the baseline for the in-app Revert feature.
- Deploy: Vercel for code, GitHub Gist for data (read at request time).

## The two views (Centre Map + Test Requirements)

Toggled by the top-bar switcher (`.view-switch`, `switchView('map'|'tests')`):

- **Centre Map** — the original map + rail (everything in `.body` + `.compare-bar`).
- **Test Requirements** — `#viewTests`: the medical-test matrix across 5
  destinations (AU / NZ / MY / GCC-WAFID / Abu Dhabi), ported from the former
  standalone dashboard.

Toggling sets a class on `#app`: `#app.view-tests` hides `.body`, `.compare-bar`
and the map-only top-bar items, and shows `#viewTests`. Returning to the map fires
a deferred `resize` (rAF + setTimeout) so Leaflet re-tiles — its container had been
`display:none` and would otherwise stay grey.

### Isolation rules — keep these when editing the Test Requirements view

The dashboard was inlined but kept fully isolated so it can't collide with the map app:

> **Design note (2026-06-30):** the map's `:root` palette was unified *up* to the Test
> view's modern look — shared blue `--accent` (#2563EB), Inter font, rounded surfaces.
> The topbar's dark colour now lives in its own `--header` token (it used to reuse
> `--accent`, which is why changing the accent no longer turns the topbar blue). The two
> views remain structurally isolated (their tokens can still diverge); they just share the
> same accent now. See the "MODERN BLUE THEME + INTERACTION POLISH" block at the end of
> the `<style>` and the CHANGELOG.

- **CSS:** every test-view rule is scoped under `#viewTests` (its design tokens
  live on `#viewTests`, not `:root`). Scope new test-view CSS the same way.
- **JS:** all test-view logic is in one IIFE exposing only
  `window.MT = { setMode, toggleCountry, showDetail, _render, … }`. Inline handlers
  in the test-view markup call `MT.*`. Don't add bare globals (the map app has its
  own `render`, `setTab`, etc.).
- **No dark mode here:** the standalone dashboard's dark-mode toggle was dropped
  (the map app is light-only). Don't reintroduce a per-view toggle; if dark mode is
  wanted, unify it across both views.

### Test-requirements data model (inline, in the `MT` IIFE)

- `COUNTRIES` — the 5 destinations (`id`, `name`, `flag`). Order matters: each
  test's `req[]` is indexed by this order.
- `DATA` — mixed rows `{type:'cat'|'sub'|'test', …}`. A `test` has `name`,
  `method`, `req:[…]` (0 = not required, 1 = required, 2 = follow-up), optional
  `note` / `trigger` / `triggerNote`.
- `OP_DATA` — per-test operational/cost notes (machine, price, cost, remarks,
  Abu-Dhabi `adNote`) keyed by test name. **Internal lab cost data** — it now rides
  on the deployed (no-auth) site; gate it if that ever becomes a concern.

### Destination linkage (Phase 2 — implemented)

The two datasets join on **destination**, not source country. The mapping lives in
`window.DEST_TAXONOMY` (`byProgramme` / `programmeByDest`): Australia↔AU,
New Zealand↔NZ, Malaysia↔MY, WAFID↔GCC, and Abu Dhabi (AD) rolls up to the WAFID
programme. UK / Canada / USA / South Korea / Japan have centres but no test data yet.

Cross-jump wiring (both live in `public/index.html`):
- **Tests → Map:** when exactly one destination is selected, `renderCrossLink()`
  fills `#mtCrossLink` with a "View N centres for [X]" bar →
  `bridgeToCentres(destId)` → `window.VMP.filterByProgramme(prog)`.
- **Map → Tests (inline):** each test-covered programme row gets a `.mt-test-link`
  🧪 button → `VMP.showTestsForProgramme(prog)`, which opens the **Test** rail tab
  with that destination's card (see below). `bridgeToTests()` still exists for jumping
  to the full matrix view but is no longer wired to the 🧪 button.
- `window.VMP` (defined inside the map IIFE) exposes `countByProgramme()`,
  `filterByProgramme()`, `setTestDest()`, `showTestsForProgramme()`; `DEST_TAXONOMY`
  + the `bridge*` fns live in the trailing bridge `<script>`. To add test data for a
  new destination, extend `MT`'s `COUNTRIES`/`DATA` and add the programme↔dest pair
  to `DEST_TAXONOMY`.

**Inline test card — the "Test" rail tab (Phase 2.1).** `renderTestCard()` (in the map
IIFE) builds a compact, single-destination card driven by `state.testDest`;
`renderTestPane()` mounts it into `#paneTest` and is called from `update()`. It reads
test data live via `MT.testsForDest(id)` (no duplicate copy) and is styled with `tc-*`
classes in the map's own `:root` tokens (unified to the modern blue palette on
2026-06-30 — so the card now matches the dashboard rather than contrasting it). Chips call
`VMP.setTestDest(id)`; the card's buttons reuse `bridgeToCentres()` (filter the map)
and `switchView('tests')` (open the full matrix). Note the rail tab bar is a
`repeat(4,1fr)` grid (`.rail-tabs`) so the 8 tabs wrap to two rows — add a 9th and it
becomes three rows, no horizontal scroll. The standalone full-matrix view remains the
place for cross-country comparison.

## Where data flows

```
data/data.json  ──push-to-gist.ps1──►  GitHub Gist  ──server.js readDB──►  /api/centres  ──fetch──►  public/index.html
                                            ▲                                                       │
                                            └─── env vars on Vercel: GIST_ID, GITHUB_TOKEN ◄────────┘
```

Local dev (no env vars) → `readDB()` falls back to `data/data.json` on disk.
Production (env vars set) → `readDB()` fetches the Gist.

## Editing rules

- **One HTML file by design.** Do NOT split `public/index.html` into separate
  CSS/JS files or introduce a bundler. The single-file architecture lets the dev
  edit and verify without npm scripts. This is a feature.
- **Don't add build steps, TypeScript, or test frameworks** — the maintainer is
  not full-time on this, and tooling overhead has cost without matching benefit.
- **No auth.** Internal tool; don't propose login flows unless asked.
- **Inline edits beat clever abstractions.** Three similar lines is fine; a
  premature helper isn't.

## Common tasks

### Add or update centres
Edit `data/data.json` (or write a one-shot script that does it). Update
`cityConcentration` to reflect new counts — there's an example pattern in git
history (search for "rebuildCityConcentration"). Always update both `data.json`
and `data-snapshot.json` if the change is permanent.

### Add a new WAFID demand city
Append an entry to `data/data.json` → `wafidDemand.cities`. Include
geocoded `lat`/`lng`. Update `data-snapshot.json` too.

### Add a new map layer
Pattern: toolbar button → `state.mapLayer` value → branch in `renderMap()` →
cleanup line at the top of `renderMap()` → optional legend swap in
`updateMapLegend()`.

### Add a new rail tab
Pattern: `<button class="rail-tab" data-tab="...">` → matching
`<div class="rail-pane" data-pane="..." id="...">` → render function called from
both `setTab()` (when activated) and `update()` (when filters change).

## After editing

For changes observable in the browser:

1. `npm start` (or `scripts/start.bat`)
2. Open `http://localhost:3000`
3. Verify the change works for the golden path AND that no other feature broke.
4. Check the browser console for errors before reporting done.

## Deployment caveat

**A Git push alone does NOT update the live data.** Vercel reads data from the
Gist. After Git push, also run `scripts/push-to-gist.ps1` whenever you've
touched any file in `data/`.

## What lives where (quick map)

| Need to find...                  | Look in                                                |
| -------------------------------- | ------------------------------------------------------ |
| Toolbar buttons (Markers/etc.)   | `public/index.html` around the `map-toolbar` block     |
| Map render branches              | `public/index.html` — `function renderMap()`           |
| Filter logic                     | `public/index.html` — `function filterCentres()`       |
| Rail tab definitions             | `public/index.html` — search `rail-tab` and `rail-pane`|
| API endpoints                    | `server/api.js`                                        |
| Gist read/write                  | `server/api.js` — `readDB()` / `writeDB()`             |
| Snapshot/Revert                  | `server/api.js` — `readSnapshot()` / `writeSnapshot()` |
| Data schema reference            | `data/data.json` first entry                           |
| Test Requirements view (UI/JS)   | `public/index.html` — `#viewTests` markup + `window.MT` IIFE |
| View switcher                    | `public/index.html` — `.view-switch` / `switchView()`  |
| Test-requirements data           | `public/index.html` — `COUNTRIES` / `DATA` / `OP_DATA` (in `MT`) |
| Cross-view linkage (Phase 2)     | `public/index.html` — `DEST_TAXONOMY`, `window.VMP`, `bridgeToCentres/bridgeToTests`, `renderCrossLink` |
| Source documents / archives      | `reference/` (PDFs, PNGs, xlsx, original dashboard)    |

## CHANGELOG hygiene

Every data change → one line in `CHANGELOG.md` with date + summary. Every
non-trivial feature → same. Skip for typo fixes.
