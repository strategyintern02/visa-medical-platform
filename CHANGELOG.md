# Changelog — Visa Medical Platform

All notable changes to this project, newest first.

## Unreleased — 2026-06-30

- **Unified the two views into one visual system.** The Centre Map and Test
  Requirements tabs previously used two clashing design-token sets (navy/sharp/Segoe
  vs. blue/rounded/Inter), so switching tabs felt like two different apps. Brought the
  Centre Map *up* to the Test Requirements "modern blue dashboard" look: shared blue
  `--accent` (#2563EB), Inter font, rounded surfaces (8–12px), softer shadows. Added a
  new `--header` token so the topbar stays dark (it used to reuse `--accent`). Because
  `var(--accent)` resolves per-scope, this flipped every active control on the map to
  blue while `#viewTests` was left untouched.
- **Interaction polish (the "visually interactive" half).** Animated segmented
  view-switcher whose active button is a blue pill (cross-fades on switch), a
  fade/rise transition when a view becomes active (respects `prefers-reduced-motion`),
  and hover/active micro-interactions on rail KPIs, tabs, toolbar groups and buttons.
  CSS-only — no JS, markup, or data changes. (`public/index.html`)
- **Follow-up tweaks.** Dropped the 🗺️/🧪 emoji from the Centre Map / Test
  Requirements switch labels. Per request, the map layer/region toolbar
  (Markers/Heatmap/… and Global/S. Asia/…) was kept at its previous-version look —
  sharp 3px corners, a dark-navy active button (`--header`), and the original Segoe UI
  font (the rest of the app moved to Inter) — so this toolbar is a *deliberate*
  exception kept identical to the pre-redesign version; don't re-modernise it.
  Also fixed the view switch: the active button itself is now the blue pill, replacing
  an earlier separate 50%-wide sliding element that misaligned because "Centre Map" and
  "Test Requirements" are different widths.
- **Map clusters now colour by status.** Marker-clusters were a flat blue ring (they
  inherited `--accent`); they now colour by the dominant status of the centres inside,
  using the rail's status palette — green Active (`--st-active`) / blue New (`--st-new`)
  / red De-panelled (`--st-depanel`), with partial-removal centres counting as
  De-panelled. Each city marker carries its status counts (`m._sc`) which the cluster
  `iconCreateFunction` aggregates via `getAllChildMarkers()`. (`public/index.html`)

## v1.0.0 — 2026-06-29

First release of the unified **Visa Medical Platform**, combining two previously
separate tools into one app with two top-level views (switched from the top bar):

- **Centre Map** — interactive map + rail dashboard of 632 visa medical centres
  across 12 source countries, filterable by 9 destination visa programmes, status,
  source country, city, and category. Map layers for markers / heatmap /
  concentration / WAFID demand. Operations writes (new empanelment / de-panel /
  re-empanel), baseline snapshot + revert, filter-aware Insights and Country panes,
  and CSV / XLSX / PDF export.
- **Test Requirements** — medical-test matrix across 5 destinations (Australia,
  New Zealand, Malaysia, GCC/WAFID, Abu Dhabi): which tests each requires, as a
  table or heatmap, with per-test method and operational/cost notes.
- **Linked by destination** — a dedicated **Test** rail tab shows a compact
  test-requirements card for a chosen destination (with a "View N centres" jump to
  the map); each test-covered programme in the map's filter has a 🧪 shortcut to its
  card; and the full matrix has a "View N centres empanelled for [X]" jump back to
  the map. The rail tab bar is a 4-column grid (8 tabs over two rows).

**Tech:** Node + Express (`server/api.js`), a single inline `public/index.html`
(no build step; Leaflet + xlsx from CDN), data in `data/data.json` (a private
GitHub Gist in production, disk in local dev), deployed on Vercel.

> Background: this platform merges the former *interactive-mapping-visa-centre* map
> tool and the standalone *Country-Wise Medical Test Requirements* dashboard into a
> single new project. The detailed pre-merge commit history lives in the original
> map repository.
