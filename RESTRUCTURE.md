# RESTRUCTURE.md — split `public/index.html` into ES modules

Living plan for breaking the single 6.6k-line `public/index.html` into clearly
bounded modules so each of the two views can be edited in isolation.

## Decisions (agreed 2026-07-02)

- **Option A — modular monolith.** ONE repo, ONE deployment. Source split into
  `map/`, `tests/`, `shared/`. Not two repos (they're integrated + share data).
- **Native ES modules** (`<script type="module">`, `import`/`export`). **No bundler,
  no build step.** Express keeps serving files as-is; edit-and-refresh still works.
- **Integrated UX stays** — the top-bar view switcher and the cross-jumps are kept.
- **Offline `__INLINE_DATA__` fallback stays.**
- Baseline for the refactor: commit `51cfbf9`.

## Why not two separate repos
The views are bidirectionally linked and share data: the map's rail "Test" card
renders the test dataset via `MT.testsForDest()`, and the test matrix filters the map
via `VMP` + `bridgeToCentres()`; `DEST_TAXONOMY` is the join. Separate repos would break
that or force a shared package + two deploys. Modules in one repo give isolated editing
with none of that cost, and upgrade cleanly to a monorepo later if independent deploys
are ever wanted.

## The seams (module contracts) — keep these STABLE
Cross-view calls must go through these globals, **never** by importing the other view's
internals. `main.js` in each view assigns its global, so inline `onclick="MT.*/VMP.*"`
handlers keep working unchanged.

- `window.VMP` — Centre Map API: `countByProgramme`, `filterByProgramme`, `setTestDest`,
  `showTestsForProgramme`.
- `window.MT` — Test Requirements API: `setMode`, `toggleCountry`, `testsForDest`,
  `selectDestById`, `toggleTheme`, `_render`, … (see current object literal).
- `window.DEST_TAXONOMY`, `switchView`, `bridgeToCentres`, `bridgeToTests` — shared bridge.
- The map's test-card calls `window.MT.testsForDest` (runtime seam), it does NOT import
  `tests/` internals.

## Target structure
```
visa-medical-platform/
├── server/api.js                 # unchanged — only Centre Map uses it
├── data/ …                       # data.json, data-snapshot.json (map only)
└── public/
    ├── index.html                # SLIM shell: topbar + view-switch + module imports
    ├── data-inline.js            # window.__INLINE_DATA__ (offline fallback, kept)
    ├── styles/
    │   ├── tokens.css            # :root tokens, *, html/body, scrollbars, base button/input
    │   ├── shell.css             # .app, .topbar, .brand*, .view-switch (+animated pill),
    │   │                         #   .btn-top, #app.view-tests display/height, view transitions
    │   ├── map.css               # .body/.map-col/.map-toolbar/.tb-*/#map/.map-legend/.rail*/
    │   │                         #   .rkpi*/.filter-*/.city-marker/.cluster-marker/.leaflet-*/
    │   │                         #   .popup-*/.btn/.pill/.compare-*/.wf-*/.tc-*/.mt-test-link
    │   └── tests.css             # everything `#viewTests …` + all `[data-theme="dark"] #viewTests …`
    └── src/
        ├── shared/
        │   ├── utils.js          # $, $$, fmt, escapeHTML, pct, debounce, haversine, downloadFile
        │   ├── taxonomy.js       # DEST_TAXONOMY
        │   └── bridge.js         # switchView, bridgeToCentres, bridgeToTests
        ├── map/
        │   ├── state.js          # map state, STATUSES, PROGRAMS
        │   ├── data.js           # loadData (+ __INLINE_DATA__ fallback), /api/centres
        │   ├── filters.js        # filterCentres, syncFilterUI, renderFilters, refreshCityFilter,
        │   │                     #   renderFilteredCentresList
        │   ├── render-map.js     # initMap, renderMap, markerClass, cluster icon, layers, legend, popups
        │   ├── kpis.js           # renderTopKpis, renderSideKpis
        │   ├── exports.js        # exportCSV/XLSX/PDF
        │   ├── compare.js        # toggleCompare, renderCompareBar, openCompareModal
        │   ├── rail/
        │   │   ├── detail.js     # renderDetail, selectCentre, centreClass, centreRow
        │   │   ├── insights.js   # renderInsights, buildInsightSpotlight
        │   │   ├── country.js    # renderCountryPane, buildCountrySpotlight
        │   │   ├── changes.js    # renderNewPane, renderDepanelPane
        │   │   ├── update.js     # renderUpdatePane + new/depanel/reempanel/snapshot/revert + showToast
        │   │   ├── wafid.js      # renderWafidPane, wireWafidPane
        │   │   └── test-card.js  # renderTestCard, renderTestPane (uses window.MT.testsForDest)
        │   └── main.js           # update, bind, setTab, boot; exposes window.VMP
        └── tests/
            ├── data.js           # COUNTRIES, DATA, OP_DATA, allTests, testsForDest
            ├── state.js          # MT state (mode, selected, tableView …)
            ├── controls.js       # setMode, onSearch, clearAll, toggleCountry/Test/Group,
            │                     #   setTableView, quickCompare, showUniversalTests, selectCountry, selectDestById
            ├── theme.js          # toggleTheme (+ persisted init)
            ├── render/
            │   ├── chips.js      # renderChips
            │   ├── stats.js      # renderStats
            │   ├── table.js      # renderTable (table + heatmap), showFuTooltip, hideFuTooltip
            │   ├── detail.js     # showDetail (op/cost panel), updateCN
            │   └── cross-link.js # renderCrossLink (uses window.VMP)
            └── main.js           # render; exposes window.MT
```

## Phases — verify in the browser after EACH (server up · both views render · one cross-jump both ways · 0 console errors)
- [x] **0. Baseline** — clean commit exists (`51cfbf9`). ✅
- [x] **1. CSS** — extracted `styles/{tokens,shell,map,tests}.css`; inline `<style>` replaced with 4 `<link>`s. Verified: both views + dark mode pixel-identical, all CSS 200, 0 console errors. index.html 6621 → 3433 lines. ✅
- [x] **2. shared/** — `taxonomy.js` + `bridge.js` extracted as ES modules (`<script type="module" src="src/shared/bridge.js">`; bridge imports taxonomy). They expose `window.{DEST_TAXONOMY,switchView,bridgeToCentres,bridgeToTests}` for the still-classic map/test IIFEs + inline handlers. Verified: view switcher + both cross-jumps + dark mode, 0 console errors. **`utils.js` deferred to Phase 4** — the utils live *inside* the map IIFE and a classic `<script>` can't `import`, so they move when the map IIFE becomes a module. ✅
- [x] **3. tests/** — Test IIFE → `src/tests/main.js` (ES module, keeps `window.MT`). Verified: view renders, dark-mode toggle, cross-jumps, 0 console errors. ✅
- [x] **4. map/** — Map IIFE → `src/map/main.js` (ES module, keeps `window.VMP`) + `src/shared/utils.js` extracted and imported. Verified: tiles/markers/632 centres, filters (AU→99), all rail tabs (Filters/Insights/Country/Update), map layers (heat/markers), cross-jumps, 0 console errors. **index.html is now a 292-line shell** (from 6621). ✅

  > Phases 3–4 extracted each view as a **single module file** (`main.js`). This achieves
  > the core goal (each view editable in isolation; index.html is a shell). The
  > **finer intra-view split** below (Phase 5) was intentionally deferred — splitting the
  > shared-closure IIFEs into many files with `import`/`export` is where subtle regressions
  > hide, so it should be done incrementally, one module at a time, verifying each.

- [ ] **5. (deeper, optional) intra-view split** — break `map/main.js` into `state.js`/`data.js`/`filters.js`/`render-map.js`/`rail/*`/`exports.js`/`compare.js` and `tests/main.js` into `data.js`/`state.js`/`controls.js`/`theme.js`/`render/*`, wiring shared state via `import`. Do one module at a time; verify after each.
- [x] **6. Housekeeping + docs** — moved `__INLINE_DATA__` → `public/data-inline.js` (classic script, loads before the modules; index.html 380 KB → 12 KB); dropped dead `bridgeToTests` from `bridge.js`; updated CLAUDE.md (tech stack, editing rules, file map — reversed the "one HTML file" rule) + README. Verified: all 12 assets 200, both views, cross-jump, dark mode, offline fallback available, 0 console errors. ✅

## CSS categorization rule of thumb
`#viewTests …` and `[data-theme="dark"] #viewTests …` → **tests.css**. `:root`/base/scrollbar
→ **tokens.css**. Topbar/brand/view-switch/app-shell/view-transition → **shell.css**.
Everything else (map, rail, markers, leaflet, filters, compare, wafid, `.tc-*`,
`.mt-test-link`) → **map.css**. The trailing "MODERN BLUE THEME + INTERACTION POLISH"
block is split by selector between shell.css and map.css.

## Rollback
Each phase = one commit. If a phase regresses, `git revert`/`reset` to the prior phase.
Baseline = `51cfbf9`.

## Deployment note
Vercel keeps serving `server/api.js` + `public/`. ES modules are plain static files under
`public/` — no route/build change. Re-verify the live deploy after Phase 5.
