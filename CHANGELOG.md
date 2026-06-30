# Changelog — Visa Medical Platform

All notable changes to this project, newest first.

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
