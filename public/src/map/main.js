// map/main.js — Centre Map view (the VMP app). Exposes window.VMP.
// Extracted from index.html (Phase 4). Uses window.{MT,DEST_TAXONOMY} at runtime (guarded); Leaflet/xlsx load as classic globals first.
import { $, $$, fmt, escapeHTML, pct, debounce } from '../shared/utils.js';

    /* =====================================================================
       Visa Medical Platform
       ---------------------------------------------------------------------
       Single-file application logic.
       Architecture:
         - state         : in-memory state (filters, selection, layer mode)
         - dataLayer     : load and normalize data from data.json
         - filterLayer   : apply current filter state to the centre array
         - mapLayer      : Leaflet rendering (markers, clusters, heatmap)
         - panelLayer    : left filter / right detail / bottom tray DOM
         - insightsLayer : computed metrics, top-N tables, data quality
         - exportLayer   : CSV / XLSX / PDF
       ===================================================================== */
    (function () {
      'use strict';

      /* ----- 1. STATE ----- */
      const STATUSES = ['Active', 'New Empanelment', 'De-panelled'];
      const PROGRAMS = ['Australia', 'UK', 'Canada', 'USA', 'New Zealand', 'South Korea', 'Japan', 'Malaysia', 'WAFID'];
      const STATUS_CLASS = {
        'Active': 'active',
        'New Empanelment': 'new',
        'De-panelled': 'depanel',
        'Under Review': 'review'   // FIX #4 — was missing, caused pill-undefined CSS class
      };

      const state = {
        data: null,
        filters: {
          search: '',
          statuses: new Set(STATUSES),       // all on by default
          programs: new Set(),                // empty = all programs
          countries: new Set(),               // empty = all
          city: '',
          category: '',
        },
        selected: null,                       // single centre id
        compare: [],                          // up to 3 centre ids
        mapLayer: 'markers',                  // markers | heat | concentration | demand
        testDest: 'AU',                       // Phase 2.1 — destination shown by the inline test card (Insights)
        wafidView: 'list',                    // list | table
        wafidSearch: '',
        wafidLevel: '',                       // '' | high | moderate | low
        wafidExpanded: new Set(),             // country names currently expanded (collapsed by default)
        wafidSort: { key: 'country', dir: 1 }, // for table view
        region: 'global',
        trayCollapsed: false,
        _depanelSelectedId:   null,           // FIX #21 — declare here so boot order doesn't matter
        _reempanelSelectedId: null,           // H-1 FIX — mirror pattern; avoids undefined if called before renderUpdatePane
      };

      /* ----- Phase 2: hooks exposed to the Test Requirements view ----- */
      window.VMP = {
        countByProgramme(prog) {
          return (state.data && state.data.centres)
            ? state.data.centres.filter(c => Array.isArray(c.programs) && c.programs.includes(prog)).length
            : 0;
        },
        filterByProgramme(prog) {
          // Mirror of the "Reset all filters" handler, but pre-select one programme.
          state.filters.search = '';
          state.filters.statuses = new Set(STATUSES);
          state.filters.programs = new Set(prog ? [prog] : []);
          state.filters.countries = new Set();
          state.filters.city = '';
          state.filters.category = '';
          syncFilterUI();
          update();
        },
        setTestDest(id) { state.testDest = id; renderTestPane(); },
        showTestsForProgramme(prog) {
          var tax = window.DEST_TAXONOMY;
          if (tax && tax.byProgramme[prog]) state.testDest = tax.byProgramme[prog];
          setTab('test');
          renderTestPane();
        }
      };


      /* ----- 3. DATA LAYER ----- */
      async function loadData() {
        let raw;

        if (window.location.protocol === 'file:') {
          // ── Opened directly as a file — use embedded inline data (read-only mode) ──
          if (window.__INLINE_DATA__) {
            raw = window.__INLINE_DATA__;
          } else {
            throw new Error('No inline data found and no server running. Open via: node server.js');
          }
        } else {
          // ── Served through the Node.js server — fetch live data from API ──
          try {
            const res = await fetch('/api/centres');
            if (!res.ok) throw new Error('Server returned ' + res.status);
            raw = await res.json();
          } catch (e) {
            // Server unreachable — fall back to inline data if available
            if (window.__INLINE_DATA__) {
              raw = window.__INLINE_DATA__;
            } else {
              throw new Error('Could not reach server (/api/centres). Start it with: node server.js — ' + e.message);
            }
          }
        }

        // Normalize & enrich
        raw.centres.forEach((c, i) => {
          c._idx = i;
          c._search = (c.name + ' ' + c.city + ' ' + c.sourceCountry + ' ' + (c.state || '') + ' ' + (c.address || '')).toLowerCase();
          if (!Array.isArray(c.programs)) c.programs = [];
          // FIX #14 — guard against null/missing programStatuses so Object.values() never throws
          if (!c.programStatuses || typeof c.programStatuses !== 'object' || Array.isArray(c.programStatuses)) {
            c.programStatuses = {};
          }
        });
        state.data = raw;
        return raw;
      }

      /* ----- 4. FILTERING ----- */
      function filterCentres() {
        const f = state.filters;
        const q = f.search.trim().toLowerCase();
        // FIX #10 — statusNarrowed is only true when SOME (not zero, not all) statuses
        // are checked. If the user unchecks everything, treat it as "no status filter"
        // so the map doesn't go blank — unchecking all = same as checking all.
        const statusNarrowed = f.statuses.size > 0 && f.statuses.size !== STATUSES.length;
        return state.data.centres.filter(c => {
          // When BOTH program and status filters are narrowed, cross-check:
          // the centre must have at least one selected program whose
          // program-level status matches one of the selected statuses.
          if (f.programs.size > 0 && statusNarrowed) {
            let crossMatch = false;
            for (const p of c.programs) {
              if (f.programs.has(p)) {
                const progStatus = c.programStatuses[p] || c.status;
                if (f.statuses.has(progStatus)) { crossMatch = true; break; }
              }
            }
            if (!crossMatch) return false;
          } else if (f.programs.size > 0) {
            // Only program filter active — just check program membership
            let any = false;
            for (const p of c.programs) { if (f.programs.has(p)) { any = true; break; } }
            if (!any) return false;
          } else if (statusNarrowed) {
            // Only status filter active (and at least one status is selected)
            const allStatuses = new Set([c.status, ...Object.values(c.programStatuses || {})]);
            let statusMatch = false;
            for (const s of allStatuses) { if (f.statuses.has(s)) { statusMatch = true; break; } }
            if (!statusMatch) return false;
          }
          // If statusNarrowed is false (all or none checked) → no status restriction
          if (f.countries.size > 0 && !f.countries.has(c.sourceCountry)) return false;
          if (f.city && c.city !== f.city) return false;
          if (f.category && c.category !== f.category) return false;
          if (q && !c._search.includes(q)) return false;
          return true;
        });
      }

      /* ----- 5. MAP LAYER ----- */
      let map, clusterGroup, heatLayer, concentrationLayer, demandLayer, markerIndex = {};

      function initMap() {
        map = L.map('map', { worldCopyJump: true, minZoom: 2, zoomControl: true })
          .setView([18, 80], 3);
        // Neutral tile (CartoDB Positron - clean, gov/exec style)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; OpenStreetMap, &copy; CARTO',
          subdomains: 'abcd',
          maxZoom: 18
        }).addTo(map);

        clusterGroup = L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: zoom => (zoom <= 4 ? 120 : 50),
          spiderfyOnMaxZoom: true,
          iconCreateFunction: cluster => {
            const n = cluster.getChildCount();
            const size = n > 100 ? 44 : n > 30 ? 38 : 32;
            // Aggregate the status of every centre inside this cluster, then colour
            // the ring by whichever status dominates (partial removal → De-panelled).
            let a = 0, nw = 0, d = 0;
            cluster.getAllChildMarkers().forEach(m => {
              const s = m._sc;
              if (s) { a += s.active; nw += s.new; d += s.dep + s.partial; }
            });
            const mx = Math.max(a, nw, d);
            let cls = 'cm-active';
            if (mx > 0) { if (d === mx) cls = 'cm-depanel'; else if (nw === mx) cls = 'cm-new'; }
            return L.divIcon({
              className: '',
              iconSize: [size, size],
              html: `<div class="cluster-marker ${cls}" style="width:${size}px;height:${size}px">${n}</div>`
            });
          }
        });
        map.on('popupclose', () => { /* keep selection in panel until explicit clear */ });
      }

      function renderMap() {
        const centres = filterCentres();
        clusterGroup.clearLayers();
        if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
        if (concentrationLayer) { map.removeLayer(concentrationLayer); concentrationLayer = null; }
        if (demandLayer) { map.removeLayer(demandLayer); demandLayer = null; }
        markerIndex = {};

        if (state.mapLayer === 'markers') {
          // Group centres by (country, city) so each city renders as ONE clickable marker.
          // Pass 1: centres WITH coordinates establish the city group and its map position.
          // Pass 2: centres WITHOUT coordinates (e.g. geocoding failed) are added to an
          //         existing city group so they still appear in the popup — they just cannot
          //         create a new marker on their own.
          const cityGroups = {};
          centres.forEach(c => {
            if (c.lat == null || c.lng == null) return;
            const k = c.sourceCountry + '|' + c.city;
            if (!cityGroups[k]) cityGroups[k] = { country: c.sourceCountry, city: c.city, lat: c.lat, lng: c.lng, centres: [] };
            cityGroups[k].centres.push(c);
          });
          centres.forEach(c => {
            if (c.lat != null && c.lng != null) return; // already handled in pass 1
            const k = c.sourceCountry + '|' + c.city;
            if (cityGroups[k]) cityGroups[k].centres.push(c); // join existing city group
          });

          Object.entries(cityGroups).forEach(([k, g]) => {
            const count = g.centres.length;

            // FIX #9 — classify each centre into exactly ONE bucket so counts
            // never overlap (a centre with both New + De-panelled programmes
            // was previously counted in both nNew and nDep, corrupting the
            // conic-gradient and tooltip).
            function markerClass(c) {
              const vals = Object.values(c.programStatuses || {});
              if (c.status === 'De-panelled') return 'depanel';
              if (vals.some(s => s === 'De-panelled')) return 'partial'; // some progs removed
              if (c.status === 'New Empanelment' || vals.some(s => s === 'New Empanelment')) return 'new';
              return 'active';
            }
            const classified = g.centres.map(markerClass);
            const nActive  = classified.filter(s => s === 'active').length;
            const nNew     = classified.filter(s => s === 'new').length;
            const nPartial = classified.filter(s => s === 'partial').length;
            const nDep     = classified.filter(s => s === 'depanel').length;

            // Mixed city = has some removal AND at least one healthy centre
            const isMixed = (nDep + nPartial) > 0 && (nActive + nNew) > 0;

            // Choose marker class
            let cls = 'cm-active';
            if (isMixed)                          cls = 'cm-mixed';
            else if (nDep + nPartial === count)   cls = 'cm-depanel';
            else if (nNew > 0)                    cls = 'cm-new';

            // Build conic-gradient for mixed cities (active=green, new=blue,
            // partial=amber, fully de-panelled=red)
            let bgStyle = '';
            if (isMixed) {
              let deg = 0;
              const stops = [];
              if (nActive  > 0) { const e = deg + Math.round(nActive  / count * 360); stops.push(`var(--st-active)  ${deg}deg ${e}deg`); deg = e; }
              if (nNew     > 0) { const e = deg + Math.round(nNew     / count * 360); stops.push(`var(--st-new)     ${deg}deg ${e}deg`); deg = e; }
              if (nPartial > 0) { const e = deg + Math.round(nPartial / count * 360); stops.push(`var(--st-review)  ${deg}deg ${e}deg`); deg = e; }
              if (nDep     > 0) { stops.push(`var(--st-depanel) ${deg}deg 360deg`); }
              bgStyle = `background:conic-gradient(${stops.join(',')});`;
            }

            // Tooltip shows the breakdown clearly
            const tipParts = [
              nActive  > 0 ? `${nActive} Active`          : '',
              nNew     > 0 ? `${nNew} New`                : '',
              nPartial > 0 ? `${nPartial} Partial removal`: '',
              nDep     > 0 ? `${nDep} De-panelled`        : '',
            ].filter(Boolean).join(' · ');
            const tip = `${escapeHTML(g.city)}, ${escapeHTML(g.country)} — ${tipParts}`;

            // Size scales with count (bigger = easier to click)
            const size = count >= 10 ? 40 : count >= 5 ? 36 : count >= 2 ? 32 : 28;
            const icon = L.divIcon({
              className: '',
              iconSize: [size, size],
              iconAnchor: [size / 2, size / 2],
              html: `<div class="city-marker ${cls}" style="width:${size}px;height:${size}px;font-size:${count >= 10 ? 13 : 12}px;${bgStyle}" title="${tip}">${count}</div>`
            });
            const m = L.marker([g.lat, g.lng], { icon, title: `${g.city}, ${g.country}` });
            m.bindPopup(() => cityPopupHTML(g), { maxWidth: 380, minWidth: 280, autoPanPadding: [40, 40] });
            m._cityKey = k;
            m._sc = { active: nActive, new: nNew, partial: nPartial, dep: nDep };
            clusterGroup.addLayer(m);
            // Index each centre's id → its city marker so 'Locate on map' still works
            g.centres.forEach(c => { markerIndex[c.id] = m; });
          });
          map.addLayer(clusterGroup);
        } else if (state.mapLayer === 'heat') {
          const pts = centres.filter(c => c.lat != null).map(c => [c.lat, c.lng, 0.7]);
          heatLayer = L.heatLayer(pts, {
            radius: 26, blur: 22, maxZoom: 8,
            gradient: { 0.2: '#9ca3af', 0.4: '#6b7280', 0.6: '#374151', 0.8: '#1f2937', 1.0: '#111827' }
          }).addTo(map);
        } else if (state.mapLayer === 'concentration') {
          // Use city concentration data — bubble per city sized by count
          concentrationLayer = L.layerGroup();
          const cityAgg = {};
          centres.forEach(c => {
            if (c.lat == null) return;
            const k = c.sourceCountry + '|' + c.city;
            if (!cityAgg[k]) cityAgg[k] = { country: c.sourceCountry, city: c.city, lat: c.lat, lng: c.lng, count: 0, centres: [] };
            cityAgg[k].count++;
            cityAgg[k].centres.push(c);
          });
          Object.values(cityAgg).forEach(cc => {
            const r = Math.max(6, Math.min(30, 4 + cc.count * 2));
            const circle = L.circleMarker([cc.lat, cc.lng], {
              radius: r,
              color: '#1f2937',
              weight: 1.5,
              opacity: .85,
              fillColor: '#374151',
              fillOpacity: .25
            });
            circle.bindPopup(`
        <div class="popup-title">${escapeHTML(cc.city)}, ${escapeHTML(cc.country)}</div>
        <div class="popup-meta">${cc.count} centre${cc.count === 1 ? '' : 's'} match current filters</div>
        ${cc.centres.slice(0, 8).map(c => `
          <div class="popup-row">
            <span><b>${escapeHTML(c.name)}</b></span>
            <span class="pill pill-${STATUS_CLASS[c.status]}"><span class="dot"></span>${c.status}</span>
          </div>`).join('')}
        ${cc.centres.length > 8 ? `<div class="popup-meta" style="margin-top:6px">+ ${cc.centres.length - 8} more</div>` : ''}
      `, { maxWidth: 340 });
            // Add count label
            const label = L.divIcon({
              className: '',
              iconSize: [r * 2, r * 2],
              iconAnchor: [r, r],
              html: `<div style="width:${r * 2}px;height:${r * 2}px;display:flex;align-items:center;justify-content:center;font-size:${r > 12 ? 12 : 10}px;font-weight:600;color:#111827;pointer-events:none">${cc.count}</div>`
            });
            const lblMarker = L.marker([cc.lat, cc.lng], { icon: label, interactive: false });
            concentrationLayer.addLayer(circle);
            concentrationLayer.addLayer(lblMarker);
          });
          concentrationLayer.addTo(map);
        } else if (state.mapLayer === 'demand') {
          // WAFID source-country demand layer. Reads state.data.wafidDemand (partial dataset).
          // Cities are color-coded High/Moderate/Low; WAFID centres in cities not on the
          // demand list are shown as a faint "no data" overlay so the absence is visible.
          demandLayer = L.layerGroup();
          const dd = state.data.wafidDemand;
          if (dd && Array.isArray(dd.cities)) {
            const cf = state.filters.countries;
            const filterActive = cf && cf.size > 0;
            const colorHex = { high: '#c53030', moderate: '#d97706', low: '#2f8a3e' };
            const demandKeys = new Set();
            dd.cities.forEach(dc => {
              if (filterActive && !cf.has(dc.country)) return;
              demandKeys.add(dc.country + '|' + dc.city);
              const fill = colorHex[dc.demand] || '#9ca3af';
              const ring = L.circleMarker([dc.lat, dc.lng], {
                radius: 11, color: '#1f2937', weight: 1.5, opacity: .9,
                fillColor: fill, fillOpacity: .55
              });
              const locLine = [dc.city, dc.state, dc.country].filter(Boolean).map(escapeHTML).join(', ');
              ring.bindPopup(`
                <div class="popup-title">${locLine}</div>
                <div class="popup-meta">WAFID source-country demand: <b style="text-transform:uppercase;color:${fill}">${escapeHTML(dc.demand)}</b></div>
              `, { maxWidth: 280 });
              demandLayer.addLayer(ring);
            });
          }
          demandLayer.addTo(map);
        }

        updateMapLegend();

        // Update toolbar counts
        const cities = new Set(centres.map(c => c.sourceCountry + '|' + c.city));
        const countries = new Set(centres.map(c => c.sourceCountry));
        $('#visibleCentres').textContent = fmt(centres.length);
        $('#totalCentres').textContent = fmt(state.data.centres.length);
        $('#visibleCities').textContent = fmt(cities.size);
        $('#visibleCountries').textContent = fmt(countries.size);
      }

      function updateMapLegend() {
        const el = $('#mapLegend');
        if (!el) return;
        if (state.mapLayer === 'demand') {
          const dd = state.data && state.data.wafidDemand;
          const cf = state.filters.countries;
          const filterActive = cf && cf.size > 0;
          const cities = dd && Array.isArray(dd.cities) ? dd.cities : [];
          const inScope = cities.filter(c => !filterActive || cf.has(c.country));
          const nHigh     = inScope.filter(c => c.demand === 'high').length;
          const nModerate = inScope.filter(c => c.demand === 'moderate').length;
          const nLow      = inScope.filter(c => c.demand === 'low').length;
          // Count "no data" cities — WAFID centre cities that aren't on the published list
          const demandKeyAll = new Set(cities.map(c => c.country + '|' + c.city));
          const noDataSet = new Set();
          (state.data.centres || []).forEach(c => {
            if (!c.programs.includes('WAFID')) return;
            const k = c.sourceCountry + '|' + c.city;
            if (demandKeyAll.has(k)) return;
            if (filterActive && !cf.has(c.sourceCountry)) return;
            noDataSet.add(k);
          });
          const note = dd && dd.note ? escapeHTML(dd.note) : 'Partial dataset — only cities WAFID publishes.';
          el.innerHTML = `
            <h4>WAFID Demand
              <span class="lg-info" title="${note}" style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:#9ca3af;color:#fff;font-size:9px;font-weight:700;margin-left:4px;cursor:help">i</span>
            </h4>
            <div class="lg-row"><span class="lg-dot" style="background:#c53030"></span> High <span style="margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums">${nHigh}</span></div>
            <div class="lg-row"><span class="lg-dot" style="background:#d97706"></span> Moderate <span style="margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums">${nModerate}</span></div>
            <div class="lg-row"><span class="lg-dot" style="background:#2f8a3e"></span> Low <span style="margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums">${nLow}</span></div>`;
        } else {
          el.innerHTML = `
            <h4>Status</h4>
            <div class="lg-row"><span class="lg-dot" style="background:var(--st-active)"></span> Active</div>
            <div class="lg-row"><span class="lg-dot" style="background:var(--st-new)"></span> New empanelment</div>
            <div class="lg-row"><span class="lg-dot" style="background:var(--st-depanel)"></span> De-panelled</div>`;
        }
      }

      function cityPopupHTML(g) {
        // Per-programme totals across all centres in this city
        const progCounts = {};
        g.centres.forEach(c => c.programs.forEach(p => { progCounts[p] = (progCounts[p] || 0) + 1; }));
        const progTotals = Object.entries(progCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([p, n]) => `<span class="pill pill-neutral" style="margin:2px 3px 2px 0">${escapeHTML(p)}: <b style="color:var(--text)">${n}</b></span>`)
          .join('');

        // Classify each centre:
        //   depanel  → top-level De-panelled OR every programme is De-panelled
        //   partial  → has at least one De-panelled programme but still has active ones
        //   new      → New Empanelment (no de-panelling)
        //   active   → fully active
        function centreClass(c) {
          const vals = Object.values(c.programStatuses || {});
          if (c.status === 'De-panelled') return 'depanel';
          if (vals.some(s => s === 'De-panelled')) return 'partial';
          if (c.status === 'New Empanelment' || vals.some(s => s === 'New Empanelment')) return 'new';
          return 'active';
        }

        function centreRow(c) {
          const cc = centreClass(c);
          const progPills = c.programs.map(p => {
            const s  = c.programStatuses[p] || c.status;
            const sc = STATUS_CLASS[s] || 'active';
            return `<span class="pill pill-${sc}" style="margin:1px 3px 1px 0;font-size:10.5px"><span class="dot"></span>${escapeHTML(p)}</span>`;
          }).join('');

          // Row-level background by class
          const rowCls = cc === 'new'     ? ' pc-new'
                       : cc === 'depanel' ? ' pc-depanel'
                       : cc === 'partial' ? ' pc-depanel'
                       : '';

          // Extra badge for non-active centres
          const badge = cc === 'depanel' ? `<span class="pill pill-depanel" style="margin-left:5px;font-size:10px;vertical-align:middle"><span class="dot"></span>De-panelled</span>`
                      : cc === 'partial' ? `<span class="pill pill-review"  style="margin-left:5px;font-size:10px;vertical-align:middle"><span class="dot"></span>Partial removal</span>`
                      : cc === 'new'     ? `<span class="pill pill-new"     style="margin-left:5px;font-size:10px;vertical-align:middle"><span class="dot"></span>New</span>`
                      : '';

          return `<div class="popup-centre${rowCls}">
            <div class="popup-centre-name"><b>${escapeHTML(c.name)}</b>${badge}</div>
            <div class="popup-centre-progs">${progPills}</div>
            <button class="popup-detail-link" onclick="window.__app.selectCentre('${escapeHTML(c.id)}')">View details →</button>
          </div>`;
        }

        // Split into groups: active/new first, then partial removals, then fully de-panelled
        const grpActive  = g.centres.filter(c => centreClass(c) === 'active');
        const grpNew     = g.centres.filter(c => centreClass(c) === 'new');
        const grpPartial = g.centres.filter(c => centreClass(c) === 'partial');
        const grpDep     = g.centres.filter(c => centreClass(c) === 'depanel');

        let centresHTML = '';
        centresHTML += grpActive.map(c => centreRow(c)).join('');
        centresHTML += grpNew.map(c => centreRow(c)).join('');
        if (grpPartial.length) {
          centresHTML += `<div class="popup-section-head" style="color:var(--st-review);border-color:var(--st-review-bd);background:var(--st-review-bg)">Partial removal — ${grpPartial.length} centre${grpPartial.length > 1 ? 's' : ''}</div>`;
          centresHTML += grpPartial.map(c => centreRow(c)).join('');
        }
        if (grpDep.length) {
          centresHTML += `<div class="popup-section-head" style="color:var(--st-depanel);border-color:var(--st-depanel-bd);background:var(--st-depanel-bg)">De-panelled — ${grpDep.length} centre${grpDep.length > 1 ? 's' : ''}</div>`;
          centresHTML += grpDep.map(c => centreRow(c)).join('');
        }

        // Status summary for the meta line
        const metaParts = [
          grpActive.length  ? `<span style="color:var(--st-active);font-weight:600">${grpActive.length} Active</span>`          : '',
          grpNew.length     ? `<span style="color:var(--st-new);font-weight:600">${grpNew.length} New</span>`                    : '',
          grpPartial.length ? `<span style="color:var(--st-review);font-weight:600">${grpPartial.length} Partial removal</span>` : '',
          grpDep.length     ? `<span style="color:var(--st-depanel);font-weight:600">${grpDep.length} De-panelled</span>`        : '',
        ].filter(Boolean).join(' &thinsp;·&thinsp; ');

        return `
    <div class="popup-title">${escapeHTML(g.city)}, ${escapeHTML(g.country)}</div>
    <div class="popup-meta" style="line-height:1.8">${g.centres.length} centre${g.centres.length === 1 ? '' : 's'} &nbsp;·&nbsp; ${metaParts}</div>
    ${progTotals ? `<div class="popup-prog-totals">${progTotals}</div>` : ''}
    <div class="popup-centres">${centresHTML}</div>
    <div class="popup-footer">Source: validated Sep 2025 panel list. Verify with destination authorities before external use.</div>
  `;
      }

      /* ----- 6. PANEL LAYER ----- */

      // --- Top KPIs (header) ---
      function renderTopKpis() {
        const all = state.data.centres;
        const countries = new Set(all.map(c => c.sourceCountry)).size;
        const cities = new Set(all.map(c => c.sourceCountry + '|' + c.city)).size;
        const html = [
          { l: 'Centres', v: fmt(all.length) },
          { l: 'Countries', v: fmt(countries) },
          { l: 'Cities', v: fmt(cities) },
          { l: 'Programs', v: fmt(new Set(all.flatMap(c => c.programs)).size) }, // FIX #19
        ].map(k => `<div class="kpi"><div class="kpi-val">${k.v}</div><div class="kpi-lbl">${k.l}</div></div>`).join('');
        $('#topKpis').innerHTML = html;
      }

      // --- Rail KPIs (live, filtered) ---
      // 'Active' counts overall=Active. 'New' and 'De-panelled' count any centre with
      // at least one such programme — so partial de-panellings (e.g. de-panelled from
      // USA only) are visible in the headline number.
      function renderSideKpis() {
        const v = filterCentres();
        const counts = {
          'Active': v.filter(c => c.status === 'Active' && !Object.values(c.programStatuses).some(s => s === 'De-panelled' || s === 'New Empanelment')).length,
          'New Empanelment': v.filter(c => Object.values(c.programStatuses).some(s => s === 'New Empanelment')).length,
          'De-panelled': v.filter(c => Object.values(c.programStatuses).some(s => s === 'De-panelled')).length,
        };
        const cities = new Set(v.map(c => c.sourceCountry + '|' + c.city)).size;
        const SHORT = { 'Active': 'Active', 'New Empanelment': 'New', 'De-panelled': 'De-panelled' };
        const SCROLL = { 'New Empanelment': 'paneNew', 'De-panelled': 'paneDepanel' };
        $('#railKpis').innerHTML = STATUSES.map(s => {
          const clickable = s === 'New Empanelment' || s === 'De-panelled';
          return `<div class="rkpi k-${STATUS_CLASS[s]}${clickable ? ' rkpi-clickable' : ''}"
            title="${s}: ${fmt(counts[s] || 0)} centres in current view${clickable ? ' — click to view list' : ''}"
            ${clickable ? `data-scrollto="${SCROLL[s]}"` : ''}>
            <div class="v">${fmt(counts[s] || 0)}</div>
            <div class="l">${SHORT[s]}</div>
          </div>`;
        }).join('') + `
    <div class="rkpi k-city" title="Unique cities in current filtered view">
      <div class="v">${fmt(cities)}</div>
      <div class="l">Cities</div>
    </div>`;
        $$('#railKpis .rkpi-clickable').forEach(card => {
          card.addEventListener('click', () => {
            setTab('changes');
            const t = card.dataset.scrollto;
            if (t) setTimeout(() => { const el = document.getElementById(t); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
          });
        });
      }

      // --- Filter checkboxes ---
      function renderFilters() {
        const all = state.data.centres;
        const byStatus = countBy(all, c => c.status);
        const byProgram = {};
        all.forEach(c => c.programs.forEach(p => { byProgram[p] = (byProgram[p] || 0) + 1; }));
        const byCountry = countBy(all, c => c.sourceCountry);

        // Status
        $('#filterStatus').innerHTML = STATUSES.map(s => `
    <label class="checkbox-row">
      <input type="checkbox" data-status="${s}" ${state.filters.statuses.has(s) ? 'checked' : ''}/>
      <span class="pill pill-${STATUS_CLASS[s]}"><span class="dot"></span>${s}</span>
      <span class="count">${fmt(byStatus[s] || 0)}</span>
    </label>
  `).join('');
        $$('#filterStatus input').forEach(inp => inp.addEventListener('change', e => {
          const s = e.target.dataset.status;
          if (e.target.checked) state.filters.statuses.add(s); else state.filters.statuses.delete(s);
          update();
        }));

        // Program
        $('#filterProgram').innerHTML = PROGRAMS.map(p => `
    <label class="checkbox-row">
      <input type="checkbox" data-program="${p}" ${state.filters.programs.has(p) ? 'checked' : ''}/>
      <span>${p}</span>
      <span class="count">${fmt(byProgram[p] || 0)}</span>
      ${(window.DEST_TAXONOMY && window.DEST_TAXONOMY.byProgramme[p]) ? `<button type="button" class="mt-test-link" title="Show ${p} test requirements" onclick="event.stopPropagation();VMP.showTestsForProgramme('${p}')">🧪</button>` : ''}
    </label>
  `).join('');
        $$('#filterProgram input').forEach(inp => inp.addEventListener('change', e => {
          const p = e.target.dataset.program;
          if (e.target.checked) state.filters.programs.add(p); else state.filters.programs.delete(p);
          update();
        }));

        // Country
        const countriesSorted = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);
        $('#filterCountry').innerHTML = countriesSorted.map(([k, v]) => `
    <label class="checkbox-row">
      <input type="checkbox" data-country="${escapeHTML(k)}" ${state.filters.countries.has(k) ? 'checked' : ''}/>
      <span>${escapeHTML(k)}</span>
      <span class="count">${fmt(v)}</span>
    </label>
  `).join('');
        $$('#filterCountry input').forEach(inp => inp.addEventListener('change', e => {
          const c = e.target.dataset.country;
          if (e.target.checked) state.filters.countries.add(c); else state.filters.countries.delete(c);
          refreshCityFilter();
          update();
        }));

        // Category dropdown
        const cats = Object.entries(countBy(all, c => c.category)).sort((a, b) => b[1] - a[1]);
        $('#filterCategory').innerHTML = `<option value="">All categories (${all.length})</option>` +
          cats.map(([k, v]) => `<option value="${escapeHTML(k)}">${escapeHTML(k)} (${v})</option>`).join('');
        // FIX #18 — use .onchange (property assignment) instead of addEventListener
        // so each renderFilters() call replaces the handler instead of stacking
        // a new duplicate listener on top of all previous ones.
        $('#filterCategory').onchange = e => {
          state.filters.category = e.target.value;
          update();
        };

        refreshCityFilter();
      }

      function refreshCityFilter() {
        const f = state.filters;
        const pool = state.data.centres.filter(c =>
          (f.countries.size === 0 || f.countries.has(c.sourceCountry))
        );
        const cityCounts = countBy(pool, c => c.sourceCountry + '|' + c.city);
        const arr = Object.entries(cityCounts)
          .map(([k, v]) => {
            // FIX #11 — split only on the FIRST pipe so city names that happen
            // to contain '|' are kept intact (was: destructuring split which
            // would assign wrong values if city contained a pipe character).
            const sep = k.indexOf('|');
            const country = k.slice(0, sep);
            const city    = k.slice(sep + 1);
            return { country, city, count: v };
          })
          .sort((a, b) => b.count - a.count);
        const cur = state.filters.city;
        $('#filterCity').innerHTML = `<option value="">All cities (${pool.length} centres)</option>` +
          arr.map(c => `<option value="${escapeHTML(c.city)}" ${c.city === cur ? 'selected' : ''}>${escapeHTML(c.city)}, ${escapeHTML(c.country)} (${c.count})</option>`).join('');
      }

      // --- Right rail: centre details ---
      function renderDetail() {
        const host = $('#detailHost');
        if (!state.selected) {
          host.innerHTML = `<div class="detail-empty" id="detailEmpty">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#9aa4b2" stroke-width="1.4"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z"/></svg>
      <div style="font-weight:500;color:var(--text-2)">No centre selected</div>
      <div style="font-size:11px;color:var(--muted-2);margin-top:10px;line-height:1.5;max-width:280px;margin-left:auto;margin-right:auto">Click any marker on the map to view full details, or pick a centre from the Country or Changes tables.</div>
    </div>`;
          return;
        }
        const c = state.data.centres.find(x => x.id === state.selected);
        if (!c) { state.selected = null; renderDetail(); return; }
        const inCompare = state.compare.includes(c.id);

        // Program table
        const progRows = c.programs.map(p => {
          const s = c.programStatuses[p] || c.status;
          return `<tr><td>${escapeHTML(p)}</td><td><span class="pill pill-${STATUS_CLASS[s]}"><span class="dot"></span>${s}</span></td></tr>`;
        }).join('') || '<tr><td colspan="2" style="color:var(--muted)">No programs flagged</td></tr>';

        // Validation info — choose pill text and colour based on validation status
        const isTeamVerified    = c.validationChannel === 'Internal verification';
        const isSourceVerified  = c.validationStatus && c.validationStatus !== 'To Validate'
                                  && c.validationStatus !== 'Internal list only - live official validation required';
        const validation = isTeamVerified
          ? `<span class="pill pill-active"><span class="dot"></span>Verified by team</span>`
          : isSourceVerified
            ? `<span class="pill pill-active"><span class="dot"></span>Source identified</span>`
            : `<span class="pill pill-review"><span class="dot"></span>Pending verification</span>`;

        host.innerHTML = `
    <div class="detail-card">
      <div class="detail-head">
        <div class="detail-name">${escapeHTML(c.name)}</div>
        <div class="detail-loc">${escapeHTML(c.city)}${c.state ? ', ' + escapeHTML(c.state) : ''} · ${escapeHTML(c.sourceCountry)}</div>
        <div class="detail-status-row">
          <span class="pill pill-${STATUS_CLASS[c.status]}"><span class="dot"></span>${c.status}</span>
          <span class="pill pill-neutral"><span class="dot"></span>${escapeHTML(c.category)}</span>
          <span class="pill pill-neutral"><span class="dot"></span>${c.programs.length} programs</span>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn ${inCompare ? 'btn-primary' : ''}" id="btnCmpAdd">${inCompare ? '✓ In compare' : '+ Add to compare'}</button>
          <button class="btn" id="btnFlyTo">Locate on map</button>
          <button class="btn btn-ghost" id="btnCloseDetail" style="margin-left:auto">Close</button>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Identification</div>
        <dl class="dl">
          <dt>Centre ID</dt><dd style="font-family:monospace;font-size:11px">${escapeHTML(c.id)}</dd>
          <dt>Source country</dt><dd>${escapeHTML(c.sourceCountry)}</dd>
          <dt>State / Region</dt><dd>${escapeHTML(c.state) || '—'}</dd>
          <dt>City</dt><dd>${escapeHTML(c.city)}</dd>
          <dt>Address</dt><dd>${escapeHTML(c.address) || '—'}</dd>
          <dt>Coordinates</dt><dd>${c.lat != null ? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : '—'} <span style="color:var(--muted);font-size:10px">${escapeHTML(c.coordConfidence) || ''}</span></dd>
        </dl>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Visa Programmes Supported</div>
        <table class="prog-table"><thead><tr><th>Programme</th><th>Status</th></tr></thead><tbody>${progRows}</tbody></table>
        <div style="margin-top:6px;font-size:11px;color:var(--muted)">M5 panel count: <b style="color:var(--text)">${c.m5PanelCount || 0}</b> · Total empanelment: <b style="color:var(--text)">${c.totalEmpanelment || 0}</b></div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Contact</div>
        <dl class="dl">
          <dt>Phone</dt><dd>${escapeHTML(c.contact) || '—'}</dd>
          <dt>Email</dt><dd>${c.email ? `<a href="mailto:${escapeHTML(c.email)}">${escapeHTML(c.email)}</a>` : '—'}</dd>
          <dt>Website</dt><dd>${c.website ? `<a href="${c.website.startsWith('http') ? escapeHTML(c.website) : 'https://' + escapeHTML(c.website)}" target="_blank" rel="noopener noreferrer">${escapeHTML(c.website)}</a>` : '—'}</dd>
        </dl>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Validation</div>
        <dl class="dl">
          <dt>Verified</dt><dd>${validation}</dd>
          <dt>Channel</dt><dd>${escapeHTML(c.validationChannel) || '—'}</dd>
          <dt>Status</dt><dd style="font-size:11px;color:var(--muted)">${escapeHTML(c.validationStatus) || '—'}</dd>
        </dl>
      </div>

      ${c.remarks ? `<div class="detail-section">
        <div class="detail-section-title">Remarks</div>
        <div style="font-size:11.5px;color:var(--text-2);line-height:1.55">${escapeHTML(c.remarks)}</div>
      </div>`: ''}
    </div>
  `;

        $('#btnCmpAdd').onclick = () => toggleCompare(c.id);
        $('#btnFlyTo').onclick = () => { if (c.lat != null) { map.flyTo([c.lat, c.lng], 9, { duration: 0.6 }); setTimeout(() => { const m = markerIndex[c.id]; if (m) m.openPopup(); }, 700); } };
        $('#btnCloseDetail').onclick = () => { state.selected = null; renderDetail(); renderInsights(); renderCountryPane(); };
      }

      function selectCentre(id) {
        state.selected = id;
        renderDetail();
        renderInsights();
        renderCountryPane();
        setTab('detail');
        // On narrow screens slide the rail in
        if (window.innerWidth < 821) {
          $('#rail').classList.add('show');
        }
      }

      /* ----- COMPARE ----- */
      function toggleCompare(id) {
        const i = state.compare.indexOf(id);
        if (i >= 0) state.compare.splice(i, 1);
        else if (state.compare.length < 3) state.compare.push(id);
        renderCompareBar();
        if (state.selected === id) renderDetail();
      }

      function renderCompareBar() {
        const bar = $('#compareBar');
        if (state.compare.length === 0) {
          bar.classList.remove('active');
          return;
        }
        bar.classList.add('active');
        const slots = [0, 1, 2].map(i => {
          const id = state.compare[i];
          if (!id) return `<div class="compare-slot empty">Slot ${i + 1}</div>`;
          const c = state.data.centres.find(x => x.id === id);
          return `<div class="compare-slot" title="${escapeHTML(c.name)}">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(c.name)}</span>
      <span class="x" data-cid="${id}">×</span>
    </div>`;
        }).join('');
        $('#compareSlots').innerHTML = slots;
        $$('#compareSlots .x').forEach(x => x.onclick = () => toggleCompare(x.dataset.cid));
      }

      function openCompareModal() {
        if (state.compare.length < 1) return;
        const centres = state.compare.map(id => state.data.centres.find(c => c.id === id)).filter(Boolean);
        if (!centres.length) return;
        const cols = `auto repeat(${centres.length}, 1fr)`;
        const fields = [
          ['Centre ID', c => `<code style="font-size:10px">${escapeHTML(c.id)}</code>`],
          ['Status', c => `<span class="pill pill-${STATUS_CLASS[c.status]}"><span class="dot"></span>${c.status}</span>`],
          ['Country', c => escapeHTML(c.sourceCountry)],
          ['City', c => escapeHTML(c.city)],
          ['State / Region', c => escapeHTML(c.state) || '—'],
          ['Category', c => escapeHTML(c.category)],
          ['Address', c => escapeHTML(c.address) || '—'],
          ['Programs supported', c => c.programs.map(p => {
            const s = c.programStatuses[p] || c.status;
            return `<span class="pill pill-${STATUS_CLASS[s]}" style="margin:1px"><span class="dot"></span>${p}</span>`;
          }).join(' ') || '—'],
          ['M5 panel count', c => fmt(c.m5PanelCount)],
          ['Total empanelment', c => fmt(c.totalEmpanelment)],
          ['Phone', c => escapeHTML(c.contact) || '—'],
          ['Email', c => c.email ? `<a href="mailto:${escapeHTML(c.email)}">${escapeHTML(c.email)}</a>` : '—'],
          ['Website', c => c.website ? `<a href="${c.website.startsWith('http') ? escapeHTML(c.website) : 'https://' + escapeHTML(c.website)}" target="_blank" rel="noopener noreferrer">${escapeHTML(c.website)}</a>` : '—'],
          ['Validation status', c => escapeHTML(c.validationStatus) || '—'],
          ['Verification source', c => escapeHTML(c.validationChannel) || '—'],
          ['Coordinates', c => c.lat != null ? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : '—'],
          ['Coord. confidence', c => escapeHTML(c.coordConfidence) || '—'],
          ['Remarks', c => escapeHTML(c.remarks) || '—'],
        ];
        // Add distance if 2+ centres
        if (centres.length >= 2) {
          fields.push(['Distance from #1', c => {
            if (c === centres[0] || c.lat == null || centres[0].lat == null) return '—';
            const d = haversine(centres[0].lat, centres[0].lng, c.lat, c.lng);
            return `${d.toFixed(0)} km`;
          }]);
        }
        let html = `<div class="cmp-grid" style="grid-template-columns:${cols}">`;
        // Header row
        html += `<div class="cmp-row header" style="grid-template-columns:${cols}">
    <div class="cmp-cell">Attribute</div>
    ${centres.map(c => `<div class="cmp-cell"><b>${escapeHTML(c.name)}</b><br/><span style="color:var(--muted);font-size:10px">${escapeHTML(c.city)}, ${escapeHTML(c.sourceCountry)}</span></div>`).join('')}
  </div>`;
        fields.forEach(([label, fn]) => {
          html += `<div class="cmp-row" style="grid-template-columns:${cols}">
      <div class="cmp-cell">${escapeHTML(label)}</div>
      ${centres.map(c => `<div class="cmp-cell">${fn(c)}</div>`).join('')}
    </div>`;
        });
        html += `</div>`;
        if (centres.length >= 2) {
          html += `<div style="margin-top:12px;font-size:11px;color:var(--muted);padding:8px 10px;background:var(--bg-soft);border:1px solid var(--border);border-radius:3px">
      <b>GIS distance matrix</b> (km, great-circle):<br/>${distanceMatrix(centres)}
    </div>`;
        }
        $('#cmpBody').innerHTML = html;
        $('#cmpModal').classList.add('active');
      }

      function haversine(lat1, lon1, lat2, lon2) {
        const R = 6371, toR = d => d * Math.PI / 180;
        const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
      }
      function distanceMatrix(arr) {
        const rows = [];
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            if (arr[i].lat == null || arr[j].lat == null) continue;
            const d = haversine(arr[i].lat, arr[i].lng, arr[j].lat, arr[j].lng);
            rows.push(`${escapeHTML(arr[i].city)} ↔ ${escapeHTML(arr[j].city)}: <b>${d.toFixed(0)} km</b>`);
          }
        }
        return rows.join(' · ') || 'Insufficient coordinates';
      }

      /* ----- 7. INSIGHTS LAYER ----- */
      function countBy(arr, fn) {
        const out = {};
        arr.forEach(x => { const k = fn(x); out[k] = (out[k] || 0) + 1; });
        return out;
      }

      // Phase 2.1 — compact, single-destination test-requirements card for the
      // Insights rail. Data is read live from the Test Requirements view (window.MT),
      // so there is no duplicate copy of the test data.
      function renderTestCard() {
        if (!window.MT || !MT.testsForDest || !state.data) return '';
        const tax = window.DEST_TAXONOMY || { programmeByDest: {} };
        const destId = state.testDest || 'AU';
        const d = MT.testsForDest(destId);
        if (!d) return '';
        const isAD = destId === 'AD';
        const prog = tax.programmeByDest[destId];
        const nCentres = prog ? state.data.centres.filter(c => Array.isArray(c.programs) && c.programs.includes(prog)).length : 0;
        const iconFor = ic => ic === 'rad' ? '🔬' : ic === 'lab' ? '🧪' : '💉';

        const chips = [['AU','🇦🇺','AU'],['NZ','🇳🇿','NZ'],['MY','🇲🇾','MY'],['GCC','🌐','WAFID'],['AD','🇦🇪','AD']]
          .map(([id, flag, lbl]) => `<button class="tc-chip${id === destId ? ' active' : ''}" onclick="VMP.setTestDest('${id}')">${flag} ${lbl}</button>`).join('');

        const groups = d.groups.map(g => `<div class="tc-group">
            <div class="tc-group-title">${iconFor(g.icon)} ${escapeHTML(g.cat)}</div>
            ${g.tests.map(t => `<div class="tc-test"><span class="tc-test-name">${escapeHTML(t.name)}</span><span class="tc-badge ${t.status}">${t.status === 'req' ? 'Required' : 'Follow-up'}</span></div>`).join('')}
          </div>`).join('');

        const centresBtn = `<button class="tc-btn primary" onclick="bridgeToCentres('${destId}')">🗺️ ${isAD ? 'View WAFID centres' : 'View ' + fmt(nCentres) + ' centres'} on the map</button>`;
        const matrixBtn = `<button class="tc-btn" onclick="switchView('tests');MT.selectDestById('${destId}')">Compare in full matrix ↗</button>`;
        const note = isAD ? `<div class="tc-note">Abu Dhabi has no centres of its own — its applicants use WAFID-empanelled centres.</div>` : '';

        return `<div class="tc-card">
          <div class="tc-head"><span class="tc-title">🧪 Test requirements</span></div>
          <div class="tc-chips">${chips}</div>
          <div class="tc-summary"><span class="tc-dest">${d.flag} ${escapeHTML(d.name)}</span><span class="tc-counts"><b>${d.counts.required}</b> required${d.counts.followUp ? ` · <b>${d.counts.followUp}</b> follow-up` : ''}</span></div>
          <div class="tc-groups">${groups}</div>
          ${note}
          <div class="tc-actions">${centresBtn}${matrixBtn}</div>
        </div>`;
      }

      function renderTestPane() { const el = $('#paneTest'); if (el) el.innerHTML = renderTestCard(); }

      function renderInsights() {
        const all = state.data.centres;
        const visible = filterCentres();
        let html = '';

        // ── Centre spotlight ─────────────────────────────────────────────
        if (state.selected) {
          const sel = all.find(x => x.id === state.selected);
          if (sel) html += buildInsightSpotlight(sel, all, visible);
        }

        // ── Empty state ──────────────────────────────────────────────────
        if (!visible.length) {
          $('#paneInsights').innerHTML = html +
            '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px">No centres match current filters.</div>';
          return;
        }

        // ── Section 1: Filtered Network Summary ───────────────────────────
        const uniqueCountries = new Set(visible.map(c => c.sourceCountry)).size;
        const uniqueCities    = new Set(visible.map(c => c.sourceCountry + '|' + c.city)).size;
        const uniqueProgs     = new Set(visible.flatMap(c => c.programs)).size;

        html += `<div class="insight-grid">
      <div class="insight"><h5>Centres</h5><div class="big">${fmt(visible.length)}</div><div class="sub">In current filter view</div></div>
      <div class="insight"><h5>Source Countries</h5><div class="big">${fmt(uniqueCountries)}</div><div class="sub">Represented</div></div>
      <div class="insight"><h5>Cities</h5><div class="big">${fmt(uniqueCities)}</div><div class="sub">Covered</div></div>
      <div class="insight"><h5>Programmes</h5><div class="big">${fmt(uniqueProgs)}</div><div class="sub">Represented</div></div>
    </div>`;

        // ── Section 2: Programme Coverage Breakdown ───────────────────────
        const progStats = {};
        PROGRAMS.forEach(p => { progStats[p] = { centres: 0, cities: new Set(), active: 0, newEmp: 0, depanel: 0 }; });
        visible.forEach(c => {
          c.programs.forEach(p => {
            if (!progStats[p]) return;
            progStats[p].centres++;
            progStats[p].cities.add(c.sourceCountry + '|' + c.city);
            const s = c.programStatuses[p] || c.status;
            if (s === 'Active') progStats[p].active++;
            else if (s === 'New Empanelment') progStats[p].newEmp++;
            else if (s === 'De-panelled') progStats[p].depanel++;
          });
        });
        const progRows = Object.entries(progStats)
          .filter(([, v]) => v.centres > 0)
          .sort((a, b) => b[1].centres - a[1].centres);

        if (progRows.length) {
          html += `<div class="section-title">Programme Coverage</div>
    <div class="tbl-scroll"><table class="tbl">
      <thead><tr>
        <th>Programme</th><th class="num">Centres</th><th class="num">Cities</th>
        <th class="num" style="color:var(--st-active)">Active</th>
        <th class="num" style="color:var(--st-new)">New</th>
        <th class="num" style="color:var(--st-depanel)">De-panel</th>
      </tr></thead>
      <tbody>${progRows.map(([p, v]) => `<tr>
        <td><span class="pill pill-neutral" style="font-size:10px">${escapeHTML(p)}</span></td>
        <td class="num">${fmt(v.centres)}</td>
        <td class="num">${fmt(v.cities.size)}</td>
        <td class="num" style="color:var(--st-active)">${v.active || '—'}</td>
        <td class="num" style="color:var(--st-new)">${v.newEmp || '—'}</td>
        <td class="num" style="color:var(--st-depanel)">${v.depanel || '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
        }

        // ── Section 2b: WAFID Demand by Source Country ───────────────────
        const dd = state.data && state.data.wafidDemand;
        if (dd && Array.isArray(dd.cities) && dd.cities.length) {
          const byCountry = {};
          dd.cities.forEach(c => {
            if (!byCountry[c.country]) byCountry[c.country] = { high: 0, moderate: 0, low: 0, total: 0 };
            byCountry[c.country][c.demand] = (byCountry[c.country][c.demand] || 0) + 1;
            byCountry[c.country].total++;
          });
          const demandRows = Object.entries(byCountry).sort((a, b) => b[1].total - a[1].total);
          const noteEsc = escapeHTML(dd.note || 'Partial dataset — only cities WAFID publishes.');
          html += `<div class="section-title">WAFID Demand by Source Country
            <span class="lg-info" title="${noteEsc}" style="display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;background:#9ca3af;color:#fff;font-size:9px;font-weight:700;margin-left:6px;cursor:help;vertical-align:middle">i</span>
          </div>
    <div class="tbl-scroll"><table class="tbl">
      <thead><tr>
        <th>Source Country</th>
        <th class="num" style="color:#c53030">High</th>
        <th class="num" style="color:#d97706">Moderate</th>
        <th class="num" style="color:#2f8a3e">Low</th>
        <th class="num">Cities</th>
      </tr></thead>
      <tbody>${demandRows.map(([country, v]) => `<tr>
        <td><button class="tbl-link" data-fcountry-demand="${escapeHTML(country)}">${escapeHTML(country)}</button></td>
        <td class="num" style="color:#c53030">${v.high || '—'}</td>
        <td class="num" style="color:#d97706">${v.moderate || '—'}</td>
        <td class="num" style="color:#2f8a3e">${v.low || '—'}</td>
        <td class="num">${v.total}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
        }

        // ── Section 3: City Concentration ────────────────────────────────
        const cityMap = {};
        visible.forEach(c => {
          const k = c.sourceCountry + '|' + c.city;
          if (!cityMap[k]) cityMap[k] = { city: c.city, country: c.sourceCountry, centres: 0, progs: new Set() };
          cityMap[k].centres++;
          c.programs.forEach(p => cityMap[k].progs.add(p));
        });
        const topCities = Object.values(cityMap).sort((a, b) => b.centres - a.centres).slice(0, 15);

        if (topCities.length) {
          html += `<div class="section-title">Cities by Centre Count</div>
    <div class="tbl-scroll"><table class="tbl">
      <thead><tr>
        <th class="rank">#</th><th>City</th><th>Country</th>
        <th class="num">Centres</th><th class="num">Programmes</th>
      </tr></thead>
      <tbody>${topCities.map((x, i) => `<tr>
        <td class="rank">${i + 1}</td>
        <td><button class="tbl-link" data-fcity="${escapeHTML(x.city)}">${escapeHTML(x.city)}</button></td>
        <td style="font-size:11px;color:var(--muted)">${escapeHTML(x.country)}</td>
        <td class="num">${fmt(x.centres)}${x.centres === 1 ? '&nbsp;<span class="pill pill-review" style="font-size:9px;padding:1px 5px;vertical-align:middle">Single</span>' : ''}</td>
        <td class="num">${x.progs.size}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
        }

        $('#paneInsights').innerHTML = html;

        // Wire city filter links
        $$('#paneInsights .tbl-link[data-fcity]').forEach(b => b.onclick = () => {
          state.filters.city = b.dataset.fcity;
          $('#filterCity').value = b.dataset.fcity;
          update();
        });
        // Wire spotlight peer links
        $$('#paneInsights .tbl-link[data-cid]').forEach(b => b.onclick = () => selectCentre(b.dataset.cid));
        // Wire demand-row country links: filter to that country AND switch to Demand layer
        $$('#paneInsights .tbl-link[data-fcountry-demand]').forEach(b => b.onclick = () => {
          const country = b.dataset.fcountryDemand;
          state.filters.countries = new Set([country]);
          state.mapLayer = 'demand';
          $$('.map-toolbar .tb-group[aria-label="Map layer"] .tb-btn').forEach(x => x.classList.toggle('active', x.dataset.layer === 'demand'));
          syncFilterUI();
          update();
        });
      }

      function buildInsightSpotlight(c, all, visible) {
        const cityKey      = c.sourceCountry + '|' + c.city;
        const cityCentres  = all.filter(x => x.sourceCountry + '|' + x.city === cityKey);
        const countryCentres = all.filter(x => x.sourceCountry === c.sourceCountry);

        const cityAvg = cityCentres.length
          ? (cityCentres.reduce((s, x) => s + x.programs.length, 0) / cityCentres.length).toFixed(1) : '—';
        const countryAvg = countryCentres.length
          ? (countryCentres.reduce((s, x) => s + x.programs.length, 0) / countryCentres.length).toFixed(1) : '—';

        const progPills = c.programs.map(p => {
          const s = c.programStatuses[p] || c.status;
          return `<span class="pill pill-${STATUS_CLASS[s] || 'neutral'}" style="margin:2px 3px 2px 0"><span class="dot"></span>${escapeHTML(p)}</span>`;
        }).join('');

        // Uniqueness signals
        const signals = [];
        const exclusiveProgs = c.programs.filter(p =>
          (c.programStatuses[p] || c.status) !== 'De-panelled' &&
          cityCentres.filter(x => x.id !== c.id && x.programs.includes(p) &&
            (x.programStatuses[p] || x.status) !== 'De-panelled').length === 0
        );
        if (exclusiveProgs.length) {
          signals.push(`<span>Only centre in <b>${escapeHTML(c.city)}</b> empanelled for <b>${exclusiveProgs.map(escapeHTML).join(', ')}</b></span>`);
        }
        // Top 20% by programme breadth in country (only meaningful with 5+ centres)
        if (countryCentres.length > 4) {
          const sorted = countryCentres.map(x => x.programs.length).sort((a, b) => b - a);
          const threshold = sorted[Math.floor(sorted.length * 0.2)] || 0;
          if (c.programs.length >= threshold) {
            signals.push(`<span>Top 20% by programme breadth in <b>${escapeHTML(c.sourceCountry)}</b></span>`);
          }
        }
        // De-panelled programmes
        const depProgs = c.programs.filter(p => (c.programStatuses[p] || c.status) === 'De-panelled');
        if (depProgs.length) {
          signals.push(`<span class="signal-alert">De-panelled from <b>${depProgs.map(escapeHTML).join(', ')}</b> — verify before referral</span>`);
        }
        // Validation pending
        if (c.validationStatus && c.validationStatus.toLowerCase().includes('priority')) {
          signals.push(`<span class="signal-warn">Validation refresh pending — confirm status with destination authority</span>`);
        }
        const signalsHTML = signals.length
          ? signals.join('<br/>')
          : '<span class="signal-ok">No flags for this centre.</span>';

        // Peer centres sharing at least one programme
        const peers = all
          .filter(x => x.id !== c.id && x.sourceCountry + '|' + x.city === cityKey && x.programs.some(p => c.programs.includes(p)))
          .slice(0, 5);
        const peersHTML = peers.length
          ? peers.map(x => {
              const shared = x.programs.filter(p => c.programs.includes(p));
              const pills  = shared.map(p => {
                const s = x.programStatuses[p] || x.status;
                return `<span class="pill pill-${STATUS_CLASS[s] || 'neutral'}" style="font-size:9px;padding:1px 5px"><span class="dot"></span>${escapeHTML(p)}</span>`;
              }).join(' ');
              return `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:11px">
                <button class="tbl-link" data-cid="${escapeHTML(x.id)}">${escapeHTML(x.name)}</button>
                <span style="margin-left:4px">${pills}</span>
              </div>`;
            }).join('')
          : `<div style="font-size:11px;color:var(--muted)">No other empanelled centres in this city.</div>`;

        return `<div class="spotlight-card">
          <div class="spotlight-title">${escapeHTML(c.name)}</div>
          <div style="margin-bottom:8px;line-height:1.8">${progPills}</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px">
            <div class="rkpi"><div class="v">${c.programs.length}</div><div class="l">This centre progs</div></div>
            <div class="rkpi"><div class="v">${cityAvg}</div><div class="l">City avg progs</div></div>
            <div class="rkpi"><div class="v">${countryAvg}</div><div class="l">Country avg progs</div></div>
          </div>
          <div class="spotlight-signals">${signalsHTML}</div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;margin:8px 0 5px">Other centres in ${escapeHTML(c.city)}</div>
          ${peersHTML}
        </div>`;
      }

      function renderCountryPane() {
        const all     = state.data.centres;
        const visible = filterCentres();
        let html = '';

        // ── Centre spotlight ─────────────────────────────────────────────
        if (state.selected) {
          const sel = all.find(x => x.id === state.selected);
          if (sel) html += buildCountrySpotlight(sel, all, visible);
        }

        const countries = Array.from(new Set(visible.map(c => c.sourceCountry))).sort();

        if (!visible.length) {
          $('#paneCountry').innerHTML = html +
            '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px">No centres match current filters.</div>';
          return;
        }

        // ── Section 1: Country Summary Cards ─────────────────────────────
        html += `<div class="section-title" style="margin-top:0">Source Countries — ${countries.length} in filtered view</div>`;
        countries.forEach(country => {
          const list   = visible.filter(c => c.sourceCountry === country);
          const cities = new Set(list.map(c => c.city)).size;
          const active = list.filter(c =>
            c.status === 'Active' &&
            !Object.values(c.programStatuses).some(s => s === 'De-panelled' || s === 'New Empanelment')
          ).length;
          const newDep = list.filter(c =>
            Object.values(c.programStatuses).some(s => s === 'New Empanelment' || s === 'De-panelled')
          ).length;
          const progs = Array.from(new Set(list.flatMap(c => c.programs)));
          html += `<div class="filter-section" style="margin-bottom:8px">
            <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">${escapeHTML(country)}</div>
            <div class="rail-kpis">
              <div class="rkpi"><div class="v">${fmt(list.length)}</div><div class="l">Centres</div></div>
              <div class="rkpi"><div class="v">${fmt(cities)}</div><div class="l">Cities</div></div>
              <div class="rkpi k-active"><div class="v">${fmt(active)}</div><div class="l">Active</div></div>
              <div class="rkpi k-review"><div class="v">${fmt(newDep)}</div><div class="l">New / Dep</div></div>
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:8px">Covers: ${progs.map(p => escapeHTML(p)).join(' · ') || '—'}</div>
          </div>`;
        });

        // ── Section 2: City × Programme Matrix (single-country filter) ───
        if (state.filters.countries.size === 1) {
          const country     = Array.from(state.filters.countries)[0];
          const cList       = visible.filter(c => c.sourceCountry === country);
          const progsP      = Array.from(new Set(cList.flatMap(c => c.programs))).sort();
          const cityMapM    = {};
          cList.forEach(c => {
            if (!cityMapM[c.city]) cityMapM[c.city] = { total: 0, progs: {} };
            cityMapM[c.city].total++;
            c.programs.forEach(p => { cityMapM[c.city].progs[p] = (cityMapM[c.city].progs[p] || 0) + 1; });
          });
          const cityRowsM = Object.entries(cityMapM)
            .map(([city, v]) => ({ city, ...v }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 20);

          if (cityRowsM.length && progsP.length) {
            html += `<div class="section-title">${escapeHTML(country)} — City Coverage Matrix</div>
    <div class="tbl-scroll"><table class="tbl">
      <thead><tr>
        <th>City</th>
        ${progsP.map(p => `<th style="text-align:center;font-size:9px;min-width:36px">${escapeHTML(p)}</th>`).join('')}
        <th class="num">Total</th>
      </tr></thead>
      <tbody>${cityRowsM.map(r => `<tr>
        <td>${escapeHTML(r.city)}</td>
        ${progsP.map(p => {
          const v = r.progs[p] || 0;
          return v ? `<td class="matrix-cell-covered">${v}</td>` : `<td class="matrix-cell-empty">—</td>`;
        }).join('')}
        <td class="num">${fmt(r.total)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${Object.keys(cityMapM).length > 20 ? '<div style="font-size:10px;color:var(--muted);margin-top:4px">Showing top 20 cities by centre count.</div>' : ''}`;
          }
        }

        // ── Section 3: Coverage Gaps (programme filter active) ────────────
        // FIX #15 — this section always scans the FULL dataset (all) because
        // "gap" means no coverage globally, not just in the filtered view.
        // The heading now says so explicitly to avoid confusion when a country
        // filter is also active.
        if (state.filters.programs.size > 0) {
          const selProgs  = Array.from(state.filters.programs);
          const allCtrys  = Array.from(new Set(all.map(c => c.sourceCountry))).sort();
          const gaps      = allCtrys.filter(country =>
            selProgs.every(p =>
              !all.some(c => c.sourceCountry === country && c.programs.includes(p) &&
                (c.programStatuses[p] || c.status) !== 'De-panelled')
            )
          );
          if (gaps.length) {
            const scopeNote = state.filters.countries.size > 0
              ? ' <span style="font-weight:400;color:var(--muted)">(across full network, not just current filter)</span>'
              : '';
            html += `<div class="section-title">Global Coverage Gaps${scopeNote}</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Source countries with <b>no active empanelled centre</b> for <b>${selProgs.map(escapeHTML).join(', ')}</b>:</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">${gaps.map(c => `<span class="pill pill-depanel"><span class="dot"></span>${escapeHTML(c)}</span>`).join('')}</div>`;
          }
        }

        $('#paneCountry').innerHTML = html;
      }

      function buildCountrySpotlight(c, all, visible) {
        const cityKey        = c.sourceCountry + '|' + c.city;
        const ctyVisible     = visible.filter(x => x.sourceCountry === c.sourceCountry);
        const cityVisible    = visible.filter(x => x.sourceCountry + '|' + x.city === cityKey);
        const countryCities  = new Set(ctyVisible.map(x => x.city)).size;

        const active   = ctyVisible.filter(x =>
          x.status === 'Active' && !Object.values(x.programStatuses).some(s => s === 'De-panelled' || s === 'New Empanelment')
        ).length;
        const newCount = ctyVisible.filter(x => Object.values(x.programStatuses).some(s => s === 'New Empanelment')).length;
        const depCount = ctyVisible.filter(x => Object.values(x.programStatuses).some(s => s === 'De-panelled')).length;

        const cityProgs          = new Set(cityVisible.flatMap(x => x.programs));
        const centreProgsInCity  = c.programs.filter(p => cityProgs.has(p)).length;

        return `<div class="spotlight-card">
          <div class="spotlight-title">${escapeHTML(c.name)}</div>
          <div style="font-size:12px;color:var(--text-2);line-height:1.9">
            Located in <b>${escapeHTML(c.city)}</b>, <b>${escapeHTML(c.sourceCountry)}</b><br/>
            <b>${escapeHTML(c.sourceCountry)}</b> has <b>${fmt(ctyVisible.length)}</b> centres across <b>${fmt(countryCities)}</b> cities in current view<br/>
            Status: <span style="color:var(--st-active)">Active ${active}</span> &nbsp;|&nbsp;
            <span style="color:var(--st-new)">New ${newCount}</span> &nbsp;|&nbsp;
            <span style="color:var(--st-depanel)">De-panel ${depCount}</span><br/>
            In <b>${escapeHTML(c.city)}</b>, there are <b>${fmt(cityVisible.length)}</b> centres total.
            <b>${escapeHTML(c.name)}</b> covers <b>${centreProgsInCity}</b> of <b>${cityProgs.size}</b> programmes available in this city.
          </div>
        </div>`;
      }

      // renderValidationPane() removed — FIX #1 (dead code, wrote to #paneValidation which no longer exists in HTML)

      function renderNewPane() {
        const news = filterCentres().filter(c => Object.values(c.programStatuses).some(s => s === 'New Empanelment'));
        $('#paneNew').innerHTML = `
    <div class="section-title" style="margin-top:0;color:var(--st-new)">▲ New empanelments — ${news.length}</div>
    ${news.length === 0
            ? `<div style="padding:16px;color:var(--muted);text-align:center;font-size:12px;background:var(--bg-card);border:1px dashed var(--border-strong);border-radius:3px">No centres currently flagged as new empanelment.</div>`
            : `<table class="tbl">
        <thead><tr><th>Centre</th><th>Location</th><th>New for</th></tr></thead>
        <tbody>
          ${news.map(c => {
              const newProgs = Object.entries(c.programStatuses).filter(([, s]) => s === 'New Empanelment').map(([p]) => p);
              return `<tr style="cursor:pointer" data-cid="${c.id}">
              <td><b>${escapeHTML(c.name)}</b><br/><span style="color:var(--muted);font-size:10px">${escapeHTML(c.id)}</span></td>
              <td style="font-size:11px">${escapeHTML(c.city)}<br/><span style="color:var(--muted);font-size:10px">${escapeHTML(c.sourceCountry)}</span></td>
              <td>${newProgs.map(p => `<span class="pill pill-new" style="margin:1px 2px 1px 0"><span class="dot"></span>${p}</span>`).join('') || '—'}</td>
            </tr>`;
            }).join('')}
        </tbody>
      </table>`
          }`;
        $$('#paneNew tbody tr').forEach(tr => tr.onclick = () => selectCentre(tr.dataset.cid));
      }

      function renderDepanelPane() {
        const dep = filterCentres().filter(c => c.status === 'De-panelled' || Object.values(c.programStatuses).some(s => s === 'De-panelled'));
        $('#paneDepanel').innerHTML = `
    <div class="section-title" style="color:var(--st-depanel)">▼ De-panellings — ${dep.length} (includes program-level removals)</div>
    ${dep.length === 0
            ? `<div style="padding:16px;color:var(--muted);text-align:center;font-size:12px;background:var(--bg-card);border:1px dashed var(--border-strong);border-radius:3px">No de-panelled centres in the active dataset.</div>`
            : `<table class="tbl">
        <thead><tr><th>Centre</th><th>Location</th><th>Removed from</th></tr></thead>
        <tbody>
          ${dep.map(c => {
              const removedFrom = Object.entries(c.programStatuses).filter(([k, v]) => v === 'De-panelled').map(([k]) => k);
              return `<tr style="cursor:pointer" data-cid="${c.id}">
              <td><b>${escapeHTML(c.name)}</b><br/><span style="color:var(--muted);font-size:10px">${escapeHTML(c.id)} · ${c.status}</span></td>
              <td style="font-size:11px">${escapeHTML(c.city)}<br/><span style="color:var(--muted);font-size:10px">${escapeHTML(c.sourceCountry)}</span></td>
              <td>${removedFrom.map(p => `<span class="pill pill-depanel" style="margin:1px 2px 1px 0"><span class="dot"></span>${p}</span>`).join('') || '<span style="color:var(--muted)">—</span>'}</td>
            </tr>`;
            }).join('')}
        </tbody>
      </table>`}`;
        $$('#paneDepanel tbody tr').forEach(tr => tr.onclick = () => selectCentre(tr.dataset.cid));
      }

      // renderQualityPane() removed — FIX #1 (dead code, wrote to #paneQualityInner which no longer exists in HTML)

      /* ----- 8. EXPORTS ----- */
      function exportCSV() {
        const rows = filterCentres();
        // FIX #16 — added programStatuses so partial de-panelments are visible in CSV
        // (previously only XLSX export included this field)
        const cols = ['id', 'name', 'category', 'sourceCountry', 'city', 'state', 'address', 'programs', 'programStatuses', 'status', 'm5PanelCount', 'totalEmpanelment', 'contact', 'email', 'website', 'lat', 'lng', 'validationStatus', 'validationChannel', 'remarks'];
        const header = cols.join(',');
        const body = rows.map(r => cols.map(k => {
          let v = r[k];
          if (Array.isArray(v))                             v = v.join(';');
          else if (v !== null && typeof v === 'object')     v = Object.entries(v).map(([pk, pv]) => `${pk}: ${pv}`).join('; ');
          if (v == null) v = '';
          v = String(v).replace(/"/g, '""');
          return /[,"\n]/.test(v) ? `"${v}"` : v;
        }).join(',')).join('\n');
        downloadFile('visa-medical-centres.csv', header + '\n' + body, 'text/csv;charset=utf-8');
      }

      // Lazy-load the heavy (~880 KB) xlsx library only when an Excel export is requested,
      // instead of on every page load.
      let _xlsxPromise = null;
      function loadXLSX() {
        if (window.XLSX) return Promise.resolve();
        if (!_xlsxPromise) _xlsxPromise = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
          s.onload = resolve;
          s.onerror = () => { _xlsxPromise = null; reject(new Error('xlsx load failed')); };
          document.head.appendChild(s);
        });
        return _xlsxPromise;
      }
      async function exportXLSX() {
        try { await loadXLSX(); }
        catch (e) { alert('Excel export unavailable — could not load the library (are you offline?).'); return; }
        const rows = filterCentres();
        const data = rows.map(r => ({
          'Centre ID': r.id,
          'Name': r.name,
          'Category': r.category,
          'Source Country': r.sourceCountry,
          'City': r.city,
          'State / Region': r.state,
          'Address': r.address,
          'Status': r.status,
          'Programs': r.programs.join('; '),
          'Program Statuses': Object.entries(r.programStatuses).map(([k, v]) => `${k}: ${v}`).join('; '),
          'M5 Panel Count': r.m5PanelCount,
          'Total Empanelment': r.totalEmpanelment,
          'Phone': r.contact,
          'Email': r.email,
          'Website': r.website,
          'Latitude': r.lat,
          'Longitude': r.lng,
          'Coord. Confidence': r.coordConfidence,
          'Validation Status': r.validationStatus,
          'Validation Channel': r.validationChannel,
          'Remarks': r.remarks,
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.min(40, Math.max(12, k.length + 2)) }));

        // Add Country intel sheet
        const all = state.data.centres;
        const countries = Array.from(new Set(all.map(c => c.sourceCountry))).sort();
        const countryRows = countries.map(country => {
          const list = all.filter(c => c.sourceCountry === country);
          return {
            'Country': country,
            'Total Centres': list.length,
            'Cities': new Set(list.map(c => c.city)).size,
            'Active': list.filter(c => c.status === 'Active').length,
            'New Empanelments': list.filter(c => c.status === 'New Empanelment').length,
            'De-panelled': list.filter(c => c.status === 'De-panelled').length,
            'Under Review': list.filter(c => c.status === 'Under Review').length,
          };
        });
        const ws2 = XLSX.utils.json_to_sheet(countryRows);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Centres');
        XLSX.utils.book_append_sheet(wb, ws2, 'Country Intel');
        XLSX.writeFile(wb, 'visa-medical-centres-intelligence.xlsx');
      }

      function exportPDF() {
        window.print();
      }

      function downloadFile(name, content, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000); // FIX #23 — was 1500ms, too short for slow machines
      }

      /* ----- 9. WIRING & UPDATE LOOP ----- */
      function syncFilterUI() {
        $$('#filterCountry input').forEach(i => { i.checked = state.filters.countries.has(i.dataset.country); });
        $$('#filterStatus input').forEach(i => { i.checked = state.filters.statuses.has(i.dataset.status); });
        $$('#filterProgram input').forEach(i => { i.checked = state.filters.programs.has(i.dataset.program); });
        $('#filterCity').value = state.filters.city || '';
        $('#filterCategory').value = state.filters.category || '';
        $('#search').value = state.filters.search || '';
      }

      function renderFilteredCentresList() {
        const f = state.filters;
        const isActive = f.countries.size > 0 || f.programs.size > 0 || f.city !== '' || f.category !== '' || f.search.trim() !== '' || f.statuses.size !== STATUSES.length;
        const container = $('#filteredCentresContainer');
        const citySec = $('#filterCitySection');
        const catSec = $('#filterCategorySection');
        if (!container) return;

        if (!isActive) {
          container.style.display = 'none';
          if (citySec) citySec.style.display = 'block';
          if (catSec) catSec.style.display = 'block';
          return;
        }

        if (citySec) citySec.style.display = 'none';
        if (catSec) catSec.style.display = 'none';

        const visible = filterCentres();
        container.style.display = 'block';
        $('#filteredCentresCount').textContent = `(${visible.length})`;

        const listEl = $('#filteredCentresList');
        if (visible.length === 0) {
          listEl.innerHTML = `<div style="padding:10px; color:var(--muted); font-size:11px; text-align:center;">No centres match your filters.</div>`;
          return;
        }

        listEl.innerHTML = visible.map(c => {
          // When program filter is active, only show pills for the selected programs
          const progsToShow = f.programs.size > 0
            ? c.programs.filter(p => f.programs.has(p))
            : c.programs;
          const progs = progsToShow.map(p => {
            const s = c.programStatuses[p] || c.status;
            return `<span class="pill pill-${STATUS_CLASS[s]}" style="margin:1px; transform:scale(0.85); transform-origin:left;"><span class="dot"></span>${p} — ${s}</span>`;
          }).join('');
          return `<div class="popup-centre" style="cursor:pointer; padding:6px 4px;" onclick="window.__app.selectCentre('${escapeHTML(c.id)}')">
            <div class="popup-centre-name" style="margin-bottom:2px"><b>${escapeHTML(c.name)}</b></div>
            <div style="font-size:10px; color:var(--muted); margin-bottom:4px;">${escapeHTML(c.city)}, ${escapeHTML(c.sourceCountry)}</div>
            <div style="line-height:1.2;">${progs || '<span style="color:var(--muted); font-size:10px;">No programs</span>'}</div>
          </div>`;
        }).join('');
      }

      function update() {
        renderMap();
        renderSideKpis();
        renderInsights();
        renderTestPane();
        renderCountryPane();
        renderNewPane();
        renderDepanelPane();
        renderFilteredCentresList();
        refreshUpdateCentreSelect();
        renderWafidPane();
        // Refresh badges
        const newCount = state.data.centres.filter(c => Object.values(c.programStatuses).some(s => s === 'New Empanelment')).length;
        const depCount = state.data.centres.filter(c => Object.values(c.programStatuses).some(s => s === 'De-panelled')).length;
        const bChanges = $('#badgeChanges'); if (bChanges) bChanges.textContent = newCount + depCount;
      }

      function bind() {
        // Search
        $('#search').addEventListener('input', debounce(e => {
          state.filters.search = e.target.value;
          update();
        }, 200));

        // City / category
        $('#filterCity').addEventListener('change', e => {
          state.filters.city = e.target.value;
          update();
        });

        // Reset
        $('#btnReset').onclick = () => {
          state.filters.search = '';
          state.filters.statuses = new Set(STATUSES);
          state.filters.programs = new Set();
          state.filters.countries = new Set();
          state.filters.city = '';
          state.filters.category = '';
          syncFilterUI();
          update();
        };

        // Map layer toggle
        $$('.map-toolbar .tb-group[aria-label="Map layer"] .tb-btn').forEach(b => b.onclick = () => {
          $$('.map-toolbar .tb-group[aria-label="Map layer"] .tb-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          state.mapLayer = b.dataset.layer;
          renderMap();
        });

        // Region quick-zoom
        const REGIONS = {
          global: [18, 80, 3],
          'south-asia': [22, 80, 5],
          'se-asia': [5, 115, 5],
          africa: [5, 20, 4],
        };
        $$('.map-toolbar .tb-group[aria-label="Region"] .tb-btn').forEach(b => b.onclick = () => {
          $$('.map-toolbar .tb-group[aria-label="Region"] .tb-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          const r = REGIONS[b.dataset.region];
          if (r) map.flyTo([r[0], r[1]], r[2], { duration: 0.7 });
        });

        // Rail tabs
        $$('.rail-tab').forEach(t => t.onclick = () => setTab(t.dataset.tab));

        // Export
        $('#btnExportCsv').onclick = exportCSV;
        $('#btnExportXlsx').onclick = exportXLSX;
        $('#btnExportPdf').onclick = exportPDF;

        // Compare
        $('#btnOpenCompare').onclick = openCompareModal;
        $('#btnClearCompare').onclick = () => { state.compare = []; renderCompareBar(); renderDetail(); };
        $('#btnCloseCompare').onclick = () => $('#cmpModal').classList.remove('active');
        $('#cmpModal').onclick = e => { if (e.target === e.currentTarget) $('#cmpModal').classList.remove('active'); };

        // Mobile rail toggle
        $('#btnRailToggle').onclick = () => $('#rail').classList.toggle('show');
        const checkResponsive = () => {
          $('#btnRailToggle').style.display = window.innerWidth < 821 ? 'inline-flex' : 'none';
        };
        checkResponsive();
        window.addEventListener('resize', debounce(() => { checkResponsive(); if (map) map.invalidateSize(); }, 200));
      }

      function setTab(name) {
        $$('.rail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        $$('.rail-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
        if (name === 'wafid') renderWafidPane();
        // On narrow screens make sure rail is visible
        if (window.innerWidth < 821) $('#rail').classList.add('show');
      }

      /* ----- BOOTSTRAP ----- */
      async function boot() {
        try {
          await loadData();
          initMap();
          renderTopKpis();
          renderFilters();
          update();
          bind();
          renderUpdatePane();
          setTimeout(() => map.invalidateSize(), 100);
        } catch (e) {
          console.error(e);
          $('#loader').innerHTML = `<div style="color:var(--st-depanel);text-align:center;padding:40px">
      <h3>Could not load data</h3>
      <p style="color:var(--muted);font-size:12px">${escapeHTML(e.message || String(e))}</p>
      <p style="color:var(--muted);font-size:11px">If you are opening this file directly with file://, browsers may block fetch(). Use a local web server (e.g. <code>python -m http.server</code>) or run the single-file build.</p>
    </div>`;
          return;
        }
        $('#loader').classList.add('hide');
      }

      /* ----- WAFID DEMAND PANE ----- */

      function renderWafidPane() {
        const pane = $('#paneWafid');
        if (!pane) return;

        // Preserve search-input focus + caret position across the re-render.
        // Without this, typing in #wfSearch loses focus on every keystroke
        // because we replace innerHTML wholesale.
        const prevSearch = document.activeElement && document.activeElement.id === 'wfSearch'
          ? { caret: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
          : null;
        const restoreSearchFocus = () => {
          if (!prevSearch) return;
          const next = pane.querySelector('#wfSearch');
          if (!next) return;
          next.focus();
          try { next.setSelectionRange(prevSearch.caret, prevSearch.end); } catch (_) {}
        };

        const dd = state.data && state.data.wafidDemand;
        if (!dd || !Array.isArray(dd.cities) || !dd.cities.length) {
          pane.innerHTML = '<div class="wf-empty">No WAFID demand data available.</div>';
          return;
        }

        const cf = state.filters.countries;
        const countryFilterActive = cf && cf.size > 0;
        const q = (state.wafidSearch || '').trim().toLowerCase();
        const lvl = state.wafidLevel || '';

        // Cities in scope: respect rail's source-country filter, then search, then demand level pill
        const inScope = dd.cities.filter(c => !countryFilterActive || cf.has(c.country));
        const matched = inScope.filter(c =>
          (!lvl || c.demand === lvl) &&
          (!q || (c.city + ' ' + (c.state || '') + ' ' + c.country).toLowerCase().includes(q))
        );

        // KPI totals based on the rail's country filter (not search/level pill)
        const total = inScope.length;
        const nHigh = inScope.filter(c => c.demand === 'high').length;
        const nMod  = inScope.filter(c => c.demand === 'moderate').length;
        const nLow  = inScope.filter(c => c.demand === 'low').length;

        const noteEsc = escapeHTML(dd.note || 'Partial dataset — only cities WAFID publishes.');
        const pubAt = dd.publishedAt ? `<span style="margin-left:auto;color:var(--muted-2);font-variant-numeric:tabular-nums">Updated ${escapeHTML(dd.publishedAt)}</span>` : '';

        let html = `
          <div class="wf-banner">
            <span class="wf-info-icon">i</span>
            <span>${noteEsc}</span>
          </div>
          <div class="wf-toolbar">
            <div class="wf-toggle" role="group" aria-label="View mode">
              <button type="button" class="${state.wafidView === 'list' ? 'active' : ''}" data-wfview="list">List</button>
              <button type="button" class="${state.wafidView === 'table' ? 'active' : ''}" data-wfview="table">Table</button>
            </div>
            <input type="text" class="input" id="wfSearch" placeholder="Search city or country…" value="${escapeHTML(state.wafidSearch || '')}" />
            <button class="btn" id="wfExport" title="Download visible rows as CSV" style="padding:5px 9px;font-size:11px">CSV</button>
          </div>
          <div class="wf-kpis">
            <div class="wf-kpi"><div class="wf-kpi-label">Cities</div><div class="wf-kpi-val">${fmt(total)}</div></div>
            <div class="wf-kpi" style="border-left:3px solid #c53030"><div class="wf-kpi-label">High</div><div class="wf-kpi-val" style="color:#c53030">${fmt(nHigh)}</div></div>
            <div class="wf-kpi" style="border-left:3px solid #d97706"><div class="wf-kpi-label">Moderate</div><div class="wf-kpi-val" style="color:#d97706">${fmt(nMod)}</div></div>
            <div class="wf-kpi" style="border-left:3px solid #2f8a3e"><div class="wf-kpi-label">Low</div><div class="wf-kpi-val" style="color:#2f8a3e">${fmt(nLow)}</div></div>
          </div>
          <div class="wf-pills">
            <button class="wf-pill ${lvl === '' ? 'active' : ''}" data-wflvl="">All</button>
            <button class="wf-pill ${lvl === 'high' ? 'active' : ''}" data-wflvl="high"><span class="wf-dot" style="background:#c53030"></span>High</button>
            <button class="wf-pill ${lvl === 'moderate' ? 'active' : ''}" data-wflvl="moderate"><span class="wf-dot" style="background:#d97706"></span>Moderate</button>
            <button class="wf-pill ${lvl === 'low' ? 'active' : ''}" data-wflvl="low"><span class="wf-dot" style="background:#2f8a3e"></span>Low</button>
          </div>`;

        if (!matched.length) {
          html += '<div class="wf-empty">No cities match the current filters.</div>';
          pane.innerHTML = html;
          wireWafidPane(matched);
          restoreSearchFocus();
          return;
        }

        if (state.wafidView === 'list') {
          // Group by country, preserving insertion order from data; expanded by default;
          // when a search or level filter is active, force-expand groups so matches are visible.
          const groups = {};
          matched.forEach(c => { (groups[c.country] = groups[c.country] || []).push(c); });
          const filterIsActive = !!q || !!lvl;

          Object.entries(groups).forEach(([country, cities]) => {
            // Collapsed by default. Expand on click, or when a search/level filter is active so matches stay visible.
            const collapsed = !filterIsActive && !state.wafidExpanded.has(country);
            html += `
              <div class="wf-group-head ${collapsed ? 'collapsed' : ''}" data-wfgroup="${escapeHTML(country)}">
                <span class="wf-caret">▾</span>
                <span>${escapeHTML(country)}</span>
                <span class="wf-group-count">${cities.length} ${cities.length === 1 ? 'city' : 'cities'}</span>
              </div>
              <div class="wf-group-body">`;
            cities
              .slice()
              .sort((a, b) => a.city.localeCompare(b.city))
              .forEach(c => {
                const cls = 'wf-badge-' + c.demand;
                const stateLabel = c.state ? `<span class="wf-city-state">${escapeHTML(c.state)}</span>` : '';
                html += `
                  <div class="wf-city">
                    <div class="wf-city-text">
                      <span class="wf-city-name">${escapeHTML(c.city)}</span>
                      ${stateLabel}
                    </div>
                    <span class="wf-badge ${cls}">${escapeHTML(c.demand)}</span>
                    <button class="wf-locate" data-wflat="${c.lat}" data-wflng="${c.lng}" data-wfcity="${escapeHTML(c.city)}" data-wfcountry="${escapeHTML(c.country)}" title="Focus on map">📍</button>
                  </div>`;
              });
            html += '</div>';
          });
        } else {
          // Table view — sortable columns
          const sk = state.wafidSort.key;
          const sd = state.wafidSort.dir;
          const demandRank = { high: 3, moderate: 2, low: 1 };
          const rows = matched.slice().sort((a, b) => {
            let av, bv;
            if (sk === 'demand') { av = demandRank[a.demand] || 0; bv = demandRank[b.demand] || 0; }
            else { av = (a[sk] || '').toString().toLowerCase(); bv = (b[sk] || '').toString().toLowerCase(); }
            if (av < bv) return -1 * sd;
            if (av > bv) return  1 * sd;
            return 0;
          });
          const arrow = (key) => sk === key ? (sd === 1 ? 'sorted-asc' : 'sorted') : '';
          html += `<div style="overflow:auto;max-height:calc(100% - 220px)">
            <table class="wf-table">
              <thead><tr>
                <th class="${arrow('country')}" data-wfsort="country">Country</th>
                <th class="${arrow('city')}" data-wfsort="city">City</th>
                <th class="${arrow('demand')}" data-wfsort="demand">Demand</th>
                <th></th>
              </tr></thead>
              <tbody>${rows.map(c => `
                <tr>
                  <td style="color:var(--muted);font-size:11px">${escapeHTML(c.country)}</td>
                  <td>
                    <b>${escapeHTML(c.city)}</b>
                    ${c.state ? `<div style="font-size:10px;color:var(--muted);margin-top:1px">${escapeHTML(c.state)}</div>` : ''}
                  </td>
                  <td><span class="wf-badge wf-badge-${c.demand}">${escapeHTML(c.demand)}</span></td>
                  <td style="text-align:right"><button class="wf-locate" data-wflat="${c.lat}" data-wflng="${c.lng}" data-wfcity="${escapeHTML(c.city)}" data-wfcountry="${escapeHTML(c.country)}" title="Focus on map">📍</button></td>
                </tr>`).join('')}</tbody>
            </table>
          </div>`;
        }

        pane.innerHTML = html;
        wireWafidPane(matched);
        restoreSearchFocus();
      }

      function wireWafidPane(visibleRows) {
        const pane = $('#paneWafid');
        if (!pane) return;

        // View toggle
        $$('#paneWafid [data-wfview]').forEach(b => b.onclick = () => {
          state.wafidView = b.dataset.wfview;
          renderWafidPane();
        });

        // Search
        const search = $('#wfSearch');
        if (search) {
          search.oninput = debounce(e => { state.wafidSearch = e.target.value; renderWafidPane(); }, 120);
        }

        // Level pills
        $$('#paneWafid [data-wflvl]').forEach(b => b.onclick = () => {
          state.wafidLevel = b.dataset.wflvl;
          renderWafidPane();
        });

        // Group collapse/expand (list view) — collapsed by default
        $$('#paneWafid [data-wfgroup]').forEach(h => h.onclick = () => {
          const c = h.dataset.wfgroup;
          if (state.wafidExpanded.has(c)) state.wafidExpanded.delete(c);
          else state.wafidExpanded.add(c);
          h.classList.toggle('collapsed');
        });

        // Table sort
        $$('#paneWafid [data-wfsort]').forEach(th => th.onclick = () => {
          const k = th.dataset.wfsort;
          if (state.wafidSort.key === k) state.wafidSort.dir *= -1;
          else { state.wafidSort.key = k; state.wafidSort.dir = 1; }
          renderWafidPane();
        });

        // Locate buttons: switch to Demand layer + flyTo + open popup
        $$('#paneWafid .wf-locate').forEach(b => b.onclick = (e) => {
          e.stopPropagation();
          const lat = parseFloat(b.dataset.wflat), lng = parseFloat(b.dataset.wflng);
          if (isNaN(lat) || isNaN(lng)) return;
          if (state.mapLayer !== 'demand') {
            state.mapLayer = 'demand';
            $$('.map-toolbar .tb-group[aria-label="Map layer"] .tb-btn').forEach(x => x.classList.toggle('active', x.dataset.layer === 'demand'));
            renderMap();
          }
          map.flyTo([lat, lng], 8, { duration: 0.7 });
          // Open the matching popup after the flyTo settles
          setTimeout(() => {
            if (!demandLayer) return;
            demandLayer.eachLayer(layer => {
              const ll = layer.getLatLng && layer.getLatLng();
              if (ll && Math.abs(ll.lat - lat) < 1e-4 && Math.abs(ll.lng - lng) < 1e-4) layer.openPopup();
            });
          }, 750);
        });

        // CSV export
        const exp = $('#wfExport');
        if (exp) exp.onclick = () => {
          const rows = [['Country', 'State', 'City', 'Demand', 'Latitude', 'Longitude']];
          visibleRows.forEach(c => rows.push([c.country, c.state || '', c.city, c.demand, c.lat, c.lng]));
          const csv = rows.map(r => r.map(v => {
            const s = (v == null ? '' : String(v));
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          }).join(',')).join('\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'wafid-demand.csv';
          document.body.appendChild(a); a.click();
          document.body.removeChild(a); URL.revokeObjectURL(url);
        };
      }

      /* ----- UPDATE PANE ----- */

      function renderUpdatePane() {
        const pane = $('#paneUpdate');
        if (!pane) return;

        pane.innerHTML = `
  <!-- BASELINE CONTROL -->
  <div class="filter-section" style="background:var(--st-review-bg);border-bottom:2px solid var(--st-review-bd);padding-bottom:14px;margin-bottom:0">
    <div class="filter-title" style="color:var(--st-review);margin-bottom:6px">&#128203; Baseline Control</div>
    <div style="font-size:11px;color:var(--text-2);line-height:1.55;margin-bottom:10px">
      Save the current state as a baseline before testing. All test changes — new empanelments, de-panelments, re-empanelments — can be undone in one click.
    </div>
    <div id="snapshotStatus" style="font-size:11px;color:var(--muted);margin-bottom:10px;padding:6px 8px;background:rgba(255,255,255,.65);border-radius:3px;border:1px solid var(--st-review-bd)">Checking baseline&hellip;</div>
    <div class="btn-row">
      <button class="btn" id="btnSaveBaseline" style="background:var(--accent);color:#fff;border-color:var(--accent);font-weight:500">&#128190; Save as Baseline</button>
      <button class="btn" id="btnRevertBaseline" style="color:var(--st-depanel);border-color:var(--st-depanel-bd);font-weight:500">&#8617; Revert to Baseline</button>
    </div>
    <div id="toastBaseline" class="toast" style="margin-top:8px"></div>
  </div>

  <div class="filter-section" style="padding-bottom:12px">
    <div class="filter-title" style="margin-bottom:10px">Select operation</div>
    <div class="update-subtabs">
      <button class="update-subtab sub-new active" data-utab="new">&#9650; New Empanelment</button>
      <button class="update-subtab sub-dep" data-utab="dep">&#9660; De-panelment</button>
      <button class="update-subtab sub-reempanel" data-utab="reempanel">&#8635; Re-empanel</button>
    </div>
  </div>

  <!-- NEW EMPANELMENT form -->
  <div class="update-form-wrap active" id="formWrapNew">
    <div class="filter-section">
      <div class="filter-title" style="color:var(--st-new);margin-bottom:10px">&#9650; New Empanelment</div>
      <div id="toastNew" class="toast"></div>

      <div class="form-group">
        <label class="form-label">Centre Name <span class="req">*</span></label>
        <input class="input" type="text" id="fnName" placeholder="e.g. HealthBridge Medical Centre" autocomplete="off"/>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group">
          <label class="form-label">City <span class="req">*</span></label>
          <input class="input" type="text" id="fnCity" placeholder="e.g. Mumbai"/>
        </div>
        <div class="form-group">
          <label class="form-label">Country <span class="req">*</span></label>
          <input class="input" type="text" id="fnCountry" placeholder="e.g. India"/>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Source Country <span class="req">*</span></label>
        <input class="input" type="text" id="fnSourceCountry" placeholder="Country of visa applicants (e.g. India)"/>
      </div>
      <div class="form-group">
        <label class="form-label">Destination Country / Programme <span class="req">*</span></label>
        <div class="prog-check-grid" id="fnDestProgs">
          ${PROGRAMS.map(p => `<label><input type="checkbox" value="${escapeHTML(p)}" class="prog-chk"/>${escapeHTML(p)}</label>`).join('')}
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:5px">Select all visa programmes this centre is empanelled for</div>
      </div>
      <div class="form-group">
        <label class="form-label">Full Address <span class="req">*</span></label>
        <textarea class="form-textarea" id="fnAddress" rows="2" placeholder="Street address, building, postal code"></textarea>
      </div>

      <div class="form-divider">Optional details</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group">
          <label class="form-label">Phone <span class="opt">(optional)</span></label>
          <input class="input" type="text" id="fnPhone" placeholder="+91 22 XXXX XXXX"/>
        </div>
        <div class="form-group">
          <label class="form-label">Email <span class="opt">(optional)</span></label>
          <input class="input" type="email" id="fnEmail" placeholder="info@centre.com"/>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Point of Contact <span class="opt">(optional)</span></label>
        <input class="input" type="text" id="fnPoc" placeholder="Name · Title · Phone"/>
      </div>
      <div class="form-group">
        <label class="form-label">Additional Remarks <span class="opt">(optional)</span></label>
        <textarea class="form-textarea" id="fnRemarks" rows="2" placeholder="Any conditions, notes, or context"></textarea>
      </div>

      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-primary" id="btnSubmitNew" style="background:var(--st-new);border-color:var(--st-new)">&#9650; Submit New Empanelment</button>
        <button class="btn" id="btnClearNew">Clear</button>
      </div>
    </div>
  </div>

  <!-- DE-PANELMENT form -->
  <div class="update-form-wrap" id="formWrapDep">
    <div class="filter-section">
      <div class="filter-title" style="color:var(--st-depanel);margin-bottom:10px">&#9660; De-panelment</div>
      <div id="toastDep" class="toast"></div>

      <div class="form-group">
        <label class="form-label">Centre Name <span class="req">*</span></label>
        <div class="typeahead-wrap">
          <input class="input" type="text" id="fdCentreSearch" placeholder="Type centre name, city, or country…" autocomplete="off"/>
          <div class="typeahead-suggestions" id="fdCentreSugs"></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group">
          <label class="form-label">Source Country</label>
          <div class="form-readonly" id="fdSourceCountry">—</div>
        </div>
        <div class="form-group">
          <label class="form-label">City</label>
          <div class="form-readonly" id="fdCity">—</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Destination Country to De-panel <span class="req">*</span></label>
        <select class="select" id="fdDestProg">
          <option value="">— Select programme —</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Reason / Remarks <span class="opt">(optional)</span></label>
        <textarea class="form-textarea" id="fdRemarks" rows="2" placeholder="Reason for de-panelment, effective date, etc."></textarea>
      </div>

      <div class="btn-row" style="margin-top:12px">
        <button class="btn" id="btnSubmitDep" style="background:var(--st-depanel);border-color:var(--st-depanel);color:#fff">&#9660; Confirm De-panelment</button>
      </div>
    </div>
  </div>

  <!-- RE-EMPANEL form -->
  <div class="update-form-wrap" id="formWrapReempanel">
    <div class="filter-section">
      <div class="filter-title" style="color:var(--st-active);margin-bottom:10px">&#8635; Re-empanel a De-panelled Centre</div>
      <div id="toastReempanel" class="toast"></div>

      <div class="form-group">
        <label class="form-label">Centre Name <span class="req">*</span></label>
        <div class="typeahead-wrap">
          <input class="input" type="text" id="frCentreSearch" placeholder="Type name of de-panelled centre…" autocomplete="off"/>
          <div class="typeahead-suggestions" id="frCentreSugs"></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group">
          <label class="form-label">Source Country</label>
          <div class="form-readonly" id="frSourceCountry">—</div>
        </div>
        <div class="form-group">
          <label class="form-label">City</label>
          <div class="form-readonly" id="frCity">—</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Programme to Re-empanel <span class="req">*</span></label>
        <select class="select" id="frDestProg">
          <option value="">— Select programme —</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Remarks <span class="opt">(optional)</span></label>
        <textarea class="form-textarea" id="frRemarks" rows="2" placeholder="Effective date, reference number, etc."></textarea>
      </div>

      <div class="btn-row" style="margin-top:12px">
        <button class="btn" id="btnSubmitReempanel" style="background:var(--st-active);border-color:var(--st-active);color:#fff">&#8635; Confirm Re-empanel</button>
      </div>
    </div>
  </div>
`;

        // Sub-tab toggle — three tabs
        $$('.update-subtab').forEach(t => t.onclick = () => {
          $$('.update-subtab').forEach(x => x.classList.remove('active'));
          t.classList.add('active');
          const tab = t.dataset.utab;
          $('#formWrapNew').classList.toggle('active',        tab === 'new');
          $('#formWrapDep').classList.toggle('active',        tab === 'dep');
          $('#formWrapReempanel').classList.toggle('active',  tab === 'reempanel');
        });

        // Programme checkbox label highlight
        $$('#fnDestProgs .prog-chk').forEach(chk => {
          chk.onchange = () => chk.closest('label').classList.toggle('prog-selected', chk.checked);
        });

        // Typeahead centre search
        state._depanelSelectedId = null;
        const searchInput = $('#fdCentreSearch');
        const sugBox = $('#fdCentreSugs');

        function fillDepanelCentre(id) {
          const c = state.data.centres.find(x => x.id === id);
          if (!c) return;
          state._depanelSelectedId = id;
          searchInput.value = c.name + ' · ' + c.city + ', ' + c.sourceCountry;
          sugBox.innerHTML = '';
          sugBox.style.display = 'none';
          $('#fdSourceCountry').textContent = c.sourceCountry;
          $('#fdCity').textContent = c.city;
          const activeProgs = c.programs.filter(p => (c.programStatuses[p] || c.status) !== 'De-panelled');
          $('#fdDestProg').innerHTML = '<option value="">— Select programme —</option>' +
            activeProgs.map(p => `<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`).join('');
        }

        function clearDepanelCentre() {
          state._depanelSelectedId = null;
          $('#fdSourceCountry').textContent = '—';
          $('#fdCity').textContent = '—';
          $('#fdDestProg').innerHTML = '<option value="">— Select programme —</option>';
        }

        searchInput.addEventListener('input', () => {
          const q = searchInput.value.trim().toLowerCase();
          clearDepanelCentre();
          if (!q) { sugBox.style.display = 'none'; sugBox.innerHTML = ''; return; }
          const eligible = state.data.centres
            .filter(c => c.programs.some(p => (c.programStatuses[p] || c.status) !== 'De-panelled'));
          const matches = eligible.filter(c =>
            c.name.toLowerCase().includes(q) ||
            c.city.toLowerCase().includes(q) ||
            c.sourceCountry.toLowerCase().includes(q)
          ).slice(0, 10);
          if (!matches.length) {
            sugBox.innerHTML = '<div class="typeahead-empty">No centres found</div>';
            sugBox.style.display = 'block';
            return;
          }
          sugBox.innerHTML = matches.map(c => `
            <div class="typeahead-item" data-id="${escapeHTML(c.id)}">
              <span class="ti-name">${escapeHTML(c.name)}</span>
              <span class="ti-meta">${escapeHTML(c.city)}, ${escapeHTML(c.sourceCountry)}</span>
            </div>`).join('');
          sugBox.style.display = 'block';
          $$('#fdCentreSugs .typeahead-item').forEach(el => {
            el.onmousedown = e => { e.preventDefault(); fillDepanelCentre(el.dataset.id); };
          });
        });

        searchInput.addEventListener('keydown', e => {
          if (e.key === 'Escape') { sugBox.style.display = 'none'; }
        });
        searchInput.addEventListener('blur', () => {
          setTimeout(() => { sugBox.style.display = 'none'; }, 150);
        });
        searchInput.addEventListener('focus', () => {
          if (sugBox.children.length && !state._depanelSelectedId) sugBox.style.display = 'block';
        });

        // ── Re-empanel typeahead ─────────────────────────────────────────
        // H-4 FIX — do NOT reset here; state._reempanelSelectedId is declared
        // in the state object and only wiped intentionally after a submit or
        // by refreshUpdateCentreSelect().
        const reSearchInput = $('#frCentreSearch');
        const reSugBox      = $('#frCentreSugs');

        function fillReempanelCentre(id) {
          const c = state.data.centres.find(x => x.id === id);
          if (!c) return;
          state._reempanelSelectedId = id;
          reSearchInput.value = c.name + ' · ' + c.city + ', ' + c.sourceCountry;
          reSugBox.innerHTML = '';
          reSugBox.style.display = 'none';
          $('#frSourceCountry').textContent = c.sourceCountry;
          $('#frCity').textContent = c.city;
          // Only show programmes that are currently De-panelled
          const depProgs = c.programs.filter(p =>
            (c.programStatuses[p] || c.status) === 'De-panelled'
          );
          $('#frDestProg').innerHTML = '<option value="">— Select programme —</option>' +
            depProgs.map(p => `<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`).join('');
        }

        function clearReempanelCentre() {
          state._reempanelSelectedId = null;
          $('#frSourceCountry').textContent = '—';
          $('#frCity').textContent = '—';
          $('#frDestProg').innerHTML = '<option value="">— Select programme —</option>';
        }

        reSearchInput.addEventListener('input', () => {
          const q = reSearchInput.value.trim().toLowerCase();
          clearReempanelCentre();
          if (!q) { reSugBox.style.display = 'none'; reSugBox.innerHTML = ''; return; }
          // Only show centres that have at least one De-panelled programme
          const eligible = state.data.centres.filter(c =>
            c.programs.some(p => (c.programStatuses[p] || c.status) === 'De-panelled')
          );
          const matches = eligible.filter(c =>
            c.name.toLowerCase().includes(q) ||
            c.city.toLowerCase().includes(q) ||
            c.sourceCountry.toLowerCase().includes(q)
          ).slice(0, 10);
          if (!matches.length) {
            reSugBox.innerHTML = '<div class="typeahead-empty">No de-panelled centres found</div>';
            reSugBox.style.display = 'block';
            return;
          }
          reSugBox.innerHTML = matches.map(c => `
            <div class="typeahead-item" data-id="${escapeHTML(c.id)}">
              <span class="ti-name">${escapeHTML(c.name)}</span>
              <span class="ti-meta">${escapeHTML(c.city)}, ${escapeHTML(c.sourceCountry)}</span>
            </div>`).join('');
          reSugBox.style.display = 'block';
          $$('#frCentreSugs .typeahead-item').forEach(el => {
            el.onmousedown = e => { e.preventDefault(); fillReempanelCentre(el.dataset.id); };
          });
        });

        reSearchInput.addEventListener('keydown', e => { if (e.key === 'Escape') reSugBox.style.display = 'none'; });
        reSearchInput.addEventListener('blur',  () => { setTimeout(() => { reSugBox.style.display = 'none'; }, 150); });
        reSearchInput.addEventListener('focus', () => { if (reSugBox.children.length && !state._reempanelSelectedId) reSugBox.style.display = 'block'; });

        $('#btnSubmitReempanel').onclick = handleReempanel;

        // Submit handlers
        $('#btnSubmitNew').onclick = handleNewEmpanelment;
        $('#btnClearNew').onclick = () => {
          ['fnName', 'fnCity', 'fnCountry', 'fnSourceCountry', 'fnAddress', 'fnPhone', 'fnEmail', 'fnPoc', 'fnRemarks']
            .forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
          $$('#fnDestProgs .prog-chk').forEach(chk => { chk.checked = false; chk.closest('label').classList.remove('prog-selected'); });
          showToast('toastNew', '', '');
        };
        $('#btnSubmitDep').onclick = handleDepanel;

        refreshUpdateCentreSelect();

        // ── Baseline Control ──────────────────────────────────────────────
        async function loadSnapshotStatus() {
          const el = $('#snapshotStatus');
          if (!el) return;
          try {
            const res  = await fetch('/api/snapshot/status');
            const data = await res.json();
            if (data.exists) {
              const when = data.savedAt
                ? new Date(data.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                : 'unknown time';
              el.innerHTML = `<span style="color:var(--st-active)">&#10003; Baseline saved</span> &mdash; ${data.count} centres &middot; ${when}`;
            } else {
              el.innerHTML = `<span style="color:var(--st-review)">&#9888; No baseline saved yet</span> &mdash; save one before running tests`;
            }
          } catch (e) {
            el.textContent = '⚠ Could not check baseline status';
          }
        }

        $('#btnSaveBaseline').onclick = async () => {
          const btn = $('#btnSaveBaseline');
          btn.disabled = true;
          btn.textContent = 'Saving…';
          showToast('toastBaseline', '', '');
          try {
            const res  = await fetch('/api/snapshot', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Server error ' + res.status);
            showToast('toastBaseline', 'success', '✓ Baseline saved — ' + data.count + ' centres captured');
            loadSnapshotStatus();
          } catch (e) {
            showToast('toastBaseline', 'error', '✗ Could not save baseline: ' + e.message);
          } finally {
            btn.disabled    = false;
            btn.textContent = '💾 Save as Baseline';
          }
        };

        $('#btnRevertBaseline').onclick = async () => {
          const confirmed = confirm(
            'Revert ALL data to the saved baseline?\n\n' +
            'This will undo every change made since the baseline was saved — new empanelments, de-panelments, and re-empanelments.\n\n' +
            'This cannot be undone. Continue?'
          );
          if (!confirmed) return;
          const btn = $('#btnRevertBaseline');
          btn.disabled = true;
          btn.textContent = 'Reverting…';
          showToast('toastBaseline', '', '');
          try {
            const res  = await fetch('/api/revert', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Server error ' + res.status);
            showToast('toastBaseline', 'success', '✓ Reverted — ' + data.count + ' centres restored. Reloading…');
            setTimeout(() => location.reload(), 1800);
          } catch (e) {
            showToast('toastBaseline', 'error', '✗ Could not revert: ' + e.message);
            btn.disabled    = false;
            btn.textContent = '↵ Revert to Baseline';
          }
        };

        loadSnapshotStatus();
      }

      function refreshUpdateCentreSelect() {
        // Invalidate De-panel selection if the chosen centre no longer has
        // any active (non-de-panelled) programmes left.
        if (state._depanelSelectedId) {
          const c = state.data.centres.find(x => x.id === state._depanelSelectedId);
          const eligible = c && c.programs.some(p => (c.programStatuses[p] || c.status) !== 'De-panelled');
          if (!eligible) {
            state._depanelSelectedId = null;
            const inp = $('#fdCentreSearch'); if (inp) inp.value = '';
            const sc  = $('#fdSourceCountry'); if (sc)  sc.textContent = '—';
            const cty = $('#fdCity');          if (cty) cty.textContent = '—';
            const dp  = $('#fdDestProg');      if (dp)  dp.innerHTML = '<option value="">— Select programme —</option>';
          }
        }

        // H-3 FIX — also invalidate Re-empanel selection if the chosen centre
        // no longer has any De-panelled programmes (e.g. all were restored).
        if (state._reempanelSelectedId) {
          const rc = state.data.centres.find(x => x.id === state._reempanelSelectedId);
          const reEligible = rc && rc.programs.some(p => (rc.programStatuses[p] || rc.status) === 'De-panelled');
          if (!reEligible) {
            state._reempanelSelectedId = null;
            const ri  = $('#frCentreSearch'); if (ri)  ri.value = '';
            const rsc = $('#frSourceCountry'); if (rsc) rsc.textContent = '—';
            const rcy = $('#frCity');          if (rcy) rcy.textContent = '—';
            const rdp = $('#frDestProg');      if (rdp) rdp.innerHTML = '<option value="">— Select programme —</option>';
          }
        }
      }

      function showToast(id, type, msg) {
        const t = $('#' + id);
        if (!t) return;
        if (!msg) { t.className = 'toast'; return; }
        t.className = 'toast show toast-' + type;
        t.textContent = msg;
        if (type === 'success') setTimeout(() => { t.className = 'toast'; }, 5000);
      }

      async function handleNewEmpanelment() {
        const name      = $('#fnName').value.trim();
        const city      = $('#fnCity').value.trim();
        const country   = $('#fnCountry').value.trim();
        const sourceCty = $('#fnSourceCountry').value.trim();
        const address   = $('#fnAddress').value.trim();
        const destProgs = Array.from($$('#fnDestProgs .prog-chk:checked')).map(c => c.value);

        if (!name)             { showToast('toastNew', 'error', 'Centre Name is required.'); return; }
        if (!city)             { showToast('toastNew', 'error', 'City is required.'); return; }
        if (!country)          { showToast('toastNew', 'error', 'Country is required.'); return; }
        if (!sourceCty)        { showToast('toastNew', 'error', 'Source Country is required.'); return; }
        if (!destProgs.length) { showToast('toastNew', 'error', 'Select at least one Destination Country / Programme.'); return; }
        if (!address)          { showToast('toastNew', 'error', 'Full Address is required.'); return; }

        const phone   = $('#fnPhone').value.trim();
        const email   = $('#fnEmail').value.trim();
        const poc     = $('#fnPoc').value.trim();
        const remarks = $('#fnRemarks').value.trim();
        const combinedRemarks = [poc ? 'Point of contact: ' + poc : '', remarks].filter(Boolean).join('\n');

        // Disable button and show saving state
        const btn = $('#btnSubmitNew');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        showToast('toastNew', '', '');

        try {
          const res = await fetch('/api/centres', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              name, city, country, sourceCountry: sourceCty,
              programs: destProgs, address,
              contact: phone, email, remarks: combinedRemarks
            })
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast('toastNew', 'error', '✗ Error: ' + (err.error || 'Server error ' + res.status));
            return;
          }

          // Server returns the saved centre including auto-geocoded coordinates
          const newCentre = await res.json();
          newCentre._idx    = state.data.centres.length;
          // FIX #6 — mirror the full _search formula from loadData (was missing state)
          newCentre._search = (newCentre.name + ' ' + newCentre.city + ' ' + newCentre.sourceCountry + ' ' + (newCentre.state || '') + ' ' + (newCentre.address || '')).toLowerCase();
          if (!Array.isArray(newCentre.programs)) newCentre.programs = [];

          state.data.centres.push(newCentre);
          update();
          renderFilters();

          const coordNote = newCentre.lat ? ' · map pin placed automatically' : ' · no map pin (city not recognised)';
          showToast('toastNew', 'success', '✓ Saved permanently: ' + name + ' (' + destProgs.join(', ') + ')' + coordNote);
          ['fnName', 'fnCity', 'fnCountry', 'fnSourceCountry', 'fnAddress', 'fnPhone', 'fnEmail', 'fnPoc', 'fnRemarks']
            .forEach(fid => { const el = $('#' + fid); if (el) el.value = ''; });
          $$('#fnDestProgs .prog-chk').forEach(chk => { chk.checked = false; chk.closest('label').classList.remove('prog-selected'); });

        } catch (e) {
          showToast('toastNew', 'error', '✗ Could not reach server: ' + e.message);
        } finally {
          btn.disabled    = false;
          btn.textContent = '▲ Submit New Empanelment';
        }
      }

      async function handleReempanel() {
        const centreId = state._reempanelSelectedId || '';
        const prog     = $('#frDestProg').value;

        if (!centreId) { showToast('toastReempanel', 'error', 'Please search and select a centre.'); return; }
        if (!prog)     { showToast('toastReempanel', 'error', 'Please select the programme to re-empanel.'); return; }

        const c = state.data.centres.find(x => x.id === centreId);
        if (!c) { showToast('toastReempanel', 'error', 'Centre not found.'); return; }

        const remarks    = $('#frRemarks').value.trim();
        const centreName = c.name;

        const btn = $('#btnSubmitReempanel');
        btn.disabled = true;
        btn.textContent = 'Saving…';

        try {
          const res = await fetch('/api/centres/' + encodeURIComponent(centreId) + '/reempanel', {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ programme: prog, remarks })
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast('toastReempanel', 'error', '✗ Error: ' + (err.error || 'Server error ' + res.status));
            return;
          }

          const updated = await res.json();
          const idx = state.data.centres.findIndex(x => x.id === centreId);
          if (idx >= 0) {
            updated._idx    = idx;
            updated._search = (updated.name + ' ' + updated.city + ' ' + updated.sourceCountry + ' ' + (updated.state || '') + ' ' + (updated.address || '')).toLowerCase();
            if (!Array.isArray(updated.programs)) updated.programs = [];
            state.data.centres[idx] = updated;
          }

          update();
          renderFilters();

          showToast('toastReempanel', 'success', '✓ Re-empanelled permanently: ' + centreName + ' for ' + prog);
          state._reempanelSelectedId = null;
          const inp = $('#frCentreSearch'); if (inp) inp.value = '';
          $('#frSourceCountry').textContent = '—';
          $('#frCity').textContent = '—';
          $('#frDestProg').innerHTML = '<option value="">— Select programme —</option>';
          $('#frRemarks').value = '';

        } catch (e) {
          showToast('toastReempanel', 'error', '✗ Could not reach server: ' + e.message);
        } finally {
          btn.disabled    = false;
          btn.textContent = '↻ Confirm Re-empanel'; // H-2 FIX — matches &#8635; used in HTML template
        }
      }

      async function handleDepanel() {
        const centreId = state._depanelSelectedId || '';
        const prog     = $('#fdDestProg').value;

        if (!centreId) { showToast('toastDep', 'error', 'Please search and select a centre.'); return; }
        if (!prog)     { showToast('toastDep', 'error', 'Please select the programme to de-panel.'); return; }

        const c = state.data.centres.find(x => x.id === centreId);
        if (!c) { showToast('toastDep', 'error', 'Centre not found.'); return; }

        const remarks    = $('#fdRemarks').value.trim();
        const centreName = c.name;

        // Disable button and show saving state
        const btn = $('#btnSubmitDep');
        btn.disabled = true;
        btn.textContent = 'Saving…';

        try {
          const res = await fetch('/api/centres/' + encodeURIComponent(centreId) + '/depanel', {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ programme: prog, remarks })
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast('toastDep', 'error', '✗ Error: ' + (err.error || 'Server error ' + res.status));
            return;
          }

          // Server returns the updated centre — patch it in-memory so UI reflects immediately
          const updated = await res.json();
          const idx = state.data.centres.findIndex(x => x.id === centreId);
          if (idx >= 0) {
            updated._idx    = idx;
            // FIX #7 — recompute _search from the updated record instead of
            // copying the stale string from the old in-memory entry
            updated._search = (updated.name + ' ' + updated.city + ' ' + updated.sourceCountry + ' ' + (updated.state || '') + ' ' + (updated.address || '')).toLowerCase();
            if (!Array.isArray(updated.programs)) updated.programs = [];
            state.data.centres[idx] = updated;
          }

          update();
          renderFilters();

          showToast('toastDep', 'success', '✓ Saved permanently: ' + centreName + ' de-panelled from ' + prog);
          state._depanelSelectedId = null;
          const inp = $('#fdCentreSearch'); if (inp) inp.value = '';
          $('#fdSourceCountry').textContent = '—';
          $('#fdCity').textContent = '—';
          $('#fdDestProg').innerHTML = '<option value="">— Select programme —</option>';
          $('#fdRemarks').value = '';

        } catch (e) {
          showToast('toastDep', 'error', '✗ Could not reach server: ' + e.message);
        } finally {
          btn.disabled    = false;
          btn.textContent = '▼ Confirm De-panelment';
        }
      }

      // Expose minimal API for popup buttons
      window.__app = { selectCentre, toggleCompare };

      document.addEventListener('DOMContentLoaded', boot);
    })();

