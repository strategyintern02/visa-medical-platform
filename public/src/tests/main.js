// tests/main.js — Test Requirements view (the MT app). Exposes window.MT.
// Extracted from index.html (Phase 3). Uses window.{VMP,DEST_TAXONOMY} at runtime (guarded).
(function(){

/* ═══════════════════════════════════════════════
   DATA CONFIGURATION
   ───────────────────────────────────────────────
   TO ADD A NEW COUNTRY:
   1. Add an entry to COUNTRIES array below
   2. Add a value (0, 1, or 2) to every test's
      `req` array in the matching position

   TO ADD A NEW TEST:
   1. Add a {type:'test', ...} object in DATA
      inside the right category section
   2. Include a `req` array with one value per
      country (0 = not required, 1 = required,
      2 = follow-up only)
   ═══════════════════════════════════════════════ */

const COUNTRIES = [
  { id: 'AU', name: 'Australia',      flag: '🇦🇺' },
  { id: 'NZ', name: 'New Zealand',    flag: '🇳🇿' },
  { id: 'MY', name: 'Malaysia',       flag: '🇲🇾' },
  { id: 'GCC', name: 'GCC (WAFID)',   flag: '🌐' },
  { id: 'AD', name: 'Abu Dhabi',      flag: '🇦🇪' },
];

const DATA = [
  { type:'cat', name:'Radiology', icon:'rad' },
  { type:'test', name:'Chest X-ray (TB screening)', method:'Digital chest radiograph (PA view; additional views if indicated)', req:[1,1,1,1,1] },

  { type:'cat', name:'Laboratory tests', icon:'lab' },

  { type:'sub', name:'Hematology' },
  { type:'test', name:'Hemoglobin', method:'Automated hematology analyzer (CBC)', req:[0,1,0,1,0] },
  { type:'test', name:'WBC', method:'Automated hematology analyzer (CBC)', req:[0,1,0,0,0] },
  { type:'test', name:'Platelets', method:'Automated hematology analyzer (CBC)', req:[0,1,0,0,0] },
  { type:'test', name:'ABO blood grouping', method:'Manual reagent-based typing', req:[0,0,1,1,0] },

  { type:'sub', name:'Biochemistry' },
  { type:'test', name:'Creatinine', method:'Serum creatinine (enzymatic or Jaffe method)', req:[1,1,1,1,0] },
  { type:'test', name:'eGFR', method:'Calculated from serum creatinine', req:[1,1,1,1,0] },
  { type:'test', name:'HbA1C', method:'HPLC or immunoassay analyzer', req:[0,1,0,0,0] },
  { type:'test', name:'Random blood sugar', method:'Hexokinase / GOD-POD (biochemistry analyzer)', req:[0,0,0,1,0] },
  { type:'test', name:'LFT (liver function)', method:'Enzymatic colorimetric assay (automated biochemistry analyzer)', req:[0,0,0,1,0] },

  { type:'sub', name:'Serology / infectious diseases' },
  { type:'test', name:'HIV', method:'Machine-based ELISA screening; if positive, confirmatory Western Blot or line-blot', req:[1,1,1,1,1] },
  { type:'test', name:'Hepatitis B (HBsAg)', method:'Immunoassay — ELISA/CLIA (automated)', req:[1,1,1,1,1], note:'Abu Dhabi: category Bi, Bii, C only. Malaysia: infectious disease screening.' },
  { type:'test', name:'Hepatitis C (Anti-HCV)', method:'Immunoassay — ELISA/CLIA (automated)', req:[1,1,1,1,1], note:'Abu Dhabi: category Bii, C only.' },
  { type:'test', name:'Syphilis (VDRL/RPR + TPHA)', method:'Non-treponemal screen (VDRL/RPR) + treponemal confirm (TPHA/TPPA/EIA)', req:[1,1,1,1,1], note:'Abu Dhabi: category Bi, Bii, C only.' },
  { type:'test', name:'Leprosy (clinical exam)', method:'Physical examination — skin and nerve assessment', req:[0,0,1,0,1], note:'Abu Dhabi: physical exam to detect leprosy across all categories. Malaysia: part of FOMEMA certification.' },

  { type:'sub', name:'TB immunology' },
  { type:'test', name:'IGRA blood test', method:'Interferon-gamma release assay (QuantiFERON Gold Plus)', req:[0,0,0,0,2], note:'Abu Dhabi: accepted as CXR substitute for follow-up/special cases only (Appendix 3).', trigger:'Chest X-ray (TB screening)', triggerNote:'Ordered when CXR shows abnormal / TB-suspicious finding (Abu Dhabi Appendix 3 follow-up cases only).' },

  { type:'sub', name:'Microbiology' },
  { type:'test', name:'TB sputum (AFB + culture + PCR)', method:'AFB smear microscopy + mycobacterial culture (solid+liquid) + NAAT; DST if culture positive', req:[1,1,0,0,2], note:'Abu Dhabi: required only for suspected PTB cases (follow-up within 3 working days of CXR finding).', trigger:'Chest X-ray (TB screening)', triggerNote:'First sputum sample must be collected within 3 working days of a TB-suspicious CXR finding.' },
  { type:'test', name:'Malaria (blood smear)', method:'Peripheral blood smear microscopy (thick & thin film)', req:[0,0,1,1,0] },
  { type:'test', name:'Microfilaria', method:'Peripheral blood smear microscopy', req:[0,0,1,1,0] },
  { type:'test', name:'Stool parasite exam', method:'Stool microscopy — routine, helminthes, ova, cyst', req:[0,0,0,1,0] },

  { type:'sub', name:'Urine tests' },
  { type:'test', name:'Urine albumin', method:'Urine dipstick', req:[0,1,1,1,0] },
  { type:'test', name:'Urine sugar', method:'Urine dipstick', req:[0,1,1,1,0] },
  { type:'test', name:'Urine blood', method:'Urine dipstick', req:[0,1,1,1,0] },
  { type:'test', name:'Pregnancy test', method:'Urine or blood hCG immunoassay (qualitative)', req:[0,1,1,0,1], note:'Abu Dhabi: mandatory for all female new/renew category Bi applicants. GCC WAFID: female applicants must not be pregnant.' },

  { type:'sub', name:'Toxicology' },
  { type:'test', name:'Drug test (opiates / cannabis)', method:'Urine immunoassay screening kit', req:[0,0,1,0,0], note:'Malaysia FOMEMA: urine drug screening for opiates, methamphetamine, and cannabinoids.' },

  { type:'cat', name:'Vaccination', icon:'vax' },
  { type:'test', name:'Polio vaccine', method:'IPV or attenuated OPV — documentation of ≥3 doses', req:[0,0,0,1,0] },
  { type:'test', name:'MMR dose 1', method:'Live attenuated vaccine', req:[0,0,0,1,0] },
  { type:'test', name:'MMR dose 2', method:'Live attenuated vaccine (1 month after dose 1)', req:[0,0,0,1,0] },
  { type:'test', name:'Meningococcal (ACWY)', method:'Conjugate vaccine — 1 dose for most adults', req:[0,0,0,1,0] },
  { type:'test', name:'DPT / Tdap', method:'Combined tetanus, diphtheria, pertussis vaccine', req:[0,0,0,1,0] },
  { type:'test', name:'Hepatitis B vaccine', method:'3-dose intramuscular course (0, 1, 6 months)', req:[0,0,0,0,1], note:'Abu Dhabi: required for category Bi, Bii, C. Exemption with attested HBV vaccine proof or positive anti-HBs Ab.' },
];

/* ─── Operational data (from Excel checklist) ─── */
const OP_DATA = {
  'Chest X-ray (TB screening)':   { machine:'Yes',        price:'700',                        cost:null,                             remarks:'Reusable apron already available in Kochi.',                                                                                              adNote:'Category A / Bi / Bii / C all include "Pulmonary tuberculosis"; Chest X-ray is a core process component.' },
  'Hemoglobin':                   { machine:'Yes',        price:'80',                         cost:'7',                              remarks:'Control cost depends on the number of counts.',                                                                                            adNote:'Hemoglobin is not listed in the Abu Dhabi category-wise screening batch.' },
  'WBC':                          { machine:'Yes',        price:null,                         cost:null,                             remarks:null,                                                                                                                                      adNote:'Not listed in the Abu Dhabi batch of screening tests by category or in the process components.' },
  'Platelets':                    { machine:'Yes',        price:null,                         cost:null,                             remarks:null,                                                                                                                                      adNote:'Not listed in the Abu Dhabi batch of screening tests by category or in the process components.' },
  'ABO blood grouping':           { machine:'Manual',     price:null,                         cost:'2.2',                            remarks:'Manual test — no machine required. Standard hematology analyzer does not perform ABO/Rh grouping; reagents needed.',                      adNote:'Not listed in the Abu Dhabi category-wise screening batch or process components.' },
  'Creatinine':                   { machine:'Yes',        price:'120',                        cost:'Enzymatic: ₹5.63 / Jaffe: ₹1.76', remarks:'Control cost depends on the number of counts.',                                                                                       adNote:'Not listed in the Abu Dhabi category-wise screening batch or process components.' },
  'eGFR':                         { machine:'Yes',        price:null,                         cost:null,                             remarks:'Calculated from serum creatinine — no additional reagent cost.',                                                                          adNote:'Same as Creatinine — not listed in Abu Dhabi batch.' },
  'HbA1C':                        { machine:'Yes',        price:null,                         cost:'100',                            remarks:'Control cost depends on the number of counts.',                                                                                            adNote:'Not listed in the Abu Dhabi category-wise screening batch.' },
  'Random blood sugar':           { machine:'Yes',        price:'FBS: ₹50',                   cost:'Hexokinase: ₹2.4 / Random: ₹1.1', remarks:'Glucose — same machine in ND. Reagents available. Control cost depends on the number of counts.',                                     adNote:'Not listed in Abu Dhabi batch. Same machine — ERBA 200. Reagent availability to be confirmed.' },
  'LFT (liver function)':         { machine:'Yes',        price:'500',                        cost:'42',                             remarks:'Includes AST, ALT, TP, Albumin, T-Bilirubin, D-Bilirubin, GGT, ALP.',                                                                    adNote:'Not listed in Abu Dhabi batch. Same machine — ERBA 200. Reagent availability for LFT to be confirmed.' },
  'HIV':                          { machine:'Yes',        price:'500',                        cost:'38.54',                          remarks:null,                                                                                                                                      adNote:'Category A new visa includes "HIV"; Bi / Bii / C and renewals also include HIV.' },
  'Hepatitis B (HBsAg)':         { machine:'Yes',        price:'250',                        cost:'36.46',                          remarks:null,                                                                                                                                      adNote:'Category Bi includes "Hepatitis B"; Category Bii / C include "Hepatitis B & C". Card-based testing.' },
  'Hepatitis C (Anti-HCV)':      { machine:'Yes',        price:'500',                        cost:'125',                            remarks:null,                                                                                                                                      adNote:'Category Bii / C include "Hepatitis B & C".' },
  'Syphilis (VDRL/RPR + TPHA)':  { machine:'Manual',     price:'VDRL ₹300 / TPHA ₹500',     cost:'2.32',                           remarks:'TPHA kit available — expiry around June. Only confirmatory test for RPR. Manual test, no machine required.',                              adNote:'Category Bi includes "Syphilis"; Bii / C also include "Syphilis".' },
  'Leprosy (clinical exam)':      { machine:null,         price:'500',                        cost:null,                             remarks:null,                                                                                                                                      adNote:'Category A / Bi / Bii / C all include "Leprosy". Standard says "Physical examination to detect leprosy".' },
  'IGRA blood test':              { machine:'Yes',        price:'1750',                       cost:'1300',                           remarks:'QFT Gold Plus.',                                                                                                                          adNote:'IGRA is not a baseline category test. Appears in TB follow-up only — "Results of TB PCR, TB culture, AFB smear and IGRA must be sent to DoH".' },
  'TB sputum (AFB + culture + PCR)': { machine:'Outsourced', price:'TBD',                    cost:null,                             remarks:'To be outsourced.',                                                                                                                       adNote:'Not a universal first-line test. Required for suspected PTB — first sputum sample collected within 3 working days of CXR TB-suspicious finding.' },
  'Malaria (blood smear)':        { machine:'Manual',     price:'210',                        cost:'26',                             remarks:'Manual rapid test. Microscope available at ND Kochi Lab. Slides to be procured; lab team training needed.',                               adNote:'Malaria is not listed in the Abu Dhabi category-wise visa screening batch.' },
  'Microfilaria':                 { machine:'Manual',     price:'200',                        cost:'208',                            remarks:'Manual antigen rapid test. Available at ND Kochi Lab.',                                                                                   adNote:'Not listed in Abu Dhabi batch.' },
  'Stool parasite exam':          { machine:'Manual',     price:'150',                        cost:null,                             remarks:'Manual — Lugol Iodine. Microscope and Normal Saline required. Separate ventilated room, SOP creation and disposal mechanism needed.',     adNote:'Not part of the Abu Dhabi category-wise screening batch or process components.' },
  'Urine albumin':                { machine:'Manual',     price:'80',                         cost:'9',                              remarks:'Manual dip stick.',                                                                                                                       adNote:'Not listed in Abu Dhabi process. Already doing urine dipstick for NZ / AU.' },
  'Urine sugar':                  { machine:'Manual',     price:'50',                         cost:null,                             remarks:'Manual dip stick.',                                                                                                                       adNote:'Not listed in Abu Dhabi batch (same as Urine Albumin).' },
  'Urine blood':                  { machine:'Manual',     price:'150',                        cost:null,                             remarks:'Manual dip stick.',                                                                                                                       adNote:'Not listed in Abu Dhabi batch (same as Urine Albumin).' },
  'Pregnancy test':               { machine:'Manual',     price:'₹300 (Urine or Blood?)',    cost:'10',                             remarks:'Rapid test. Cards procured. Confirm if blood pregnancy test (serum) card is separate.',                                                   adNote:'"Pregnancy test must be performed for all female new and renew residence visa applicants Category Bi." CXR deferred if pregnancy test is positive.' },
  'Drug test (opiates / cannabis)': { machine:'Manual',  price:'150',                        cost:'120',                            remarks:'Rapid test. Kit available at ND. New machine.',                                                                                           adNote:'Drug testing is not listed in the Abu Dhabi category-wise screening batch or process components.' },
  'Polio vaccine':                { machine:null,         price:null,                         cost:null,                             remarks:'Not available at ND Kochi.',                                                                                                              adNote:'Abu Dhabi standard lists vaccination for Hepatitis B only. Polio not listed in Abu Dhabi requirements.' },
  'MMR dose 1':                   { machine:'Manual',     price:null,                         cost:'380',                            remarks:'TRESIVAC - PFS.',                                                                                                                        adNote:'Abu Dhabi standard lists vaccination for Hepatitis B only. MMR not listed in Abu Dhabi requirements.' },
  'MMR dose 2':                   { machine:null,         price:null,                         cost:null,                             remarks:null,                                                                                                                                      adNote:'Abu Dhabi standard lists vaccination for Hepatitis B only. MMR not listed in Abu Dhabi requirements.' },
  'Meningococcal (ACWY)':         { machine:'Manual',     price:null,                         cost:'2377',                           remarks:'MENFIVE.',                                                                                                                               adNote:'Abu Dhabi standard lists vaccination for Hepatitis B only. Meningococcal not listed in Abu Dhabi requirements.' },
  'DPT / Tdap':                   { machine:'Manual',     price:null,                         cost:'195',                            remarks:'QUADROVAX-SD.',                                                                                                                          adNote:'Abu Dhabi standard lists vaccination for Hepatitis B only. DPT not listed in Abu Dhabi requirements.' },
  'Hepatitis B vaccine':          { machine:'Manual',     price:'250',                        cost:'67.36',                          remarks:'GENEVAC-B (ADULT DOSE).',                                                                                                               adNote:'Category Bi / Bii / C include "Vaccination for Hepatitis B". Renewals: verify doses taken, start course if not completed. Exempt if attested HBV vaccine proof or positive anti-HBs Ab.' },
};

/* ─── State ─── */
let mode = 'country';
let selectedCountries = new Set();
let selectedTests = new Set();
let searchTerm = '';
let _chipGroups = []; // indexed group test-name arrays for toggleGroup()
let tableView = 'table'; // 'table' | 'heatmap'

function allTests() { return DATA.filter(d => d.type === 'test'); }

/* ─── Mode ─── */
function setMode(m, btn) {
  mode = m;
  tableView = 'table';
  selectedCountries.clear();
  selectedTests.clear();
  searchTerm = '';
  document.getElementById('searchInput').value = '';
  document.querySelectorAll('.mode-switch button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  render();
}

function clearAll() {
  selectedCountries.clear();
  selectedTests.clear();
  searchTerm = '';
  document.getElementById('searchInput').value = '';
  render();
}

function onSearch() {
  searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
  render();
}

/* ─── Toggle selections ─── */
function toggleCountry(idx) {
  if (selectedCountries.has(idx)) selectedCountries.delete(idx);
  else selectedCountries.add(idx);
  render();
}

function toggleTest(name) {
  if (selectedTests.has(name)) selectedTests.delete(name);
  else selectedTests.add(name);
  render();
}

function toggleGroup(idx) {
  const names = _chipGroups[idx];
  if (!names) return;
  const allSel = names.every(n => selectedTests.has(n));
  names.forEach(n => allSel ? selectedTests.delete(n) : selectedTests.add(n));
  render();
}

function setTableView(v) {
  tableView = v;
  renderTable();
}

function quickCompare(indices) {
  if (mode !== 'country') {
    mode = 'country';
    tableView = 'table';
    document.querySelectorAll('.mode-switch button').forEach((b, i) => b.classList.toggle('active', i === 0));
  }
  selectedCountries.clear();
  indices.forEach(i => selectedCountries.add(i));
  render();
}

function showUniversalTests() {
  mode = 'test';
  tableView = 'table';
  selectedCountries.clear();
  selectedTests.clear();
  allTests().filter(t => t.req.every(v => v >= 1)).forEach(t => selectedTests.add(t.name));
  document.querySelectorAll('.mode-switch button').forEach((b, i) => b.classList.toggle('active', i === 1));
  render();
}

function selectCountry(idx) {
  mode = 'country';
  tableView = 'table';
  selectedTests.clear();
  selectedCountries.clear();
  selectedCountries.add(idx);
  document.querySelectorAll('.mode-switch button').forEach((b, i) => b.classList.toggle('active', i === 0));
  render();
}

/* ─── Render everything ─── */
function render() {
  renderChips();
  renderStats();
  renderTable();
  renderCrossLink();
  document.getElementById('detailPanel').classList.remove('open');
}

/* ─── Phase 2.1: grouped test requirements for one destination (read-only) ─── */
function testsForDest(id) {
  const idx = COUNTRIES.findIndex(c => c.id === id);
  if (idx < 0) return null;
  const dest = COUNTRIES[idx];
  const groups = []; let cur = null; let nReq = 0, nFu = 0;
  DATA.forEach(d => {
    if (d.type === 'cat') { cur = { cat: d.name, icon: d.icon, tests: [] }; groups.push(cur); }
    else if (d.type === 'test' && cur) {
      const v = d.req[idx];
      if (v >= 1) {
        cur.tests.push({ name: d.name, status: v === 1 ? 'req' : 'fu' });
        if (v === 1) nReq++; else nFu++;
      }
    }
  });
  return {
    id: dest.id, name: dest.name, flag: dest.flag,
    groups: groups.filter(g => g.tests.length),
    counts: { required: nReq, followUp: nFu, total: nReq + nFu }
  };
}

/* ─── Phase 2: jump to the Centre Map for the selected destination ─── */
function selectDestById(id) {
  const idx = COUNTRIES.findIndex(c => c.id === id);
  if (idx >= 0) selectCountry(idx);
}
function renderCrossLink() {
  const el = document.getElementById('mtCrossLink');
  if (!el) return;
  const tax = window.DEST_TAXONOMY;
  if (mode === 'country' && selectedCountries.size === 1 && tax) {
    const dest = COUNTRIES[[...selectedCountries][0]];
    const prog = tax.programmeByDest[dest.id];
    if (prog) {
      const n = window.VMP ? window.VMP.countByProgramme(prog) : null;
      const progLabel = (dest.id === 'AD') ? 'WAFID' : dest.name;
      const note = (dest.id === 'AD')
        ? '<span class="mt-cl-note">Abu Dhabi centres are empanelled under the WAFID programme.</span>'
        : '';
      el.innerHTML =
        '<div class="mt-cl-inner">'
        + '<span>' + dest.flag + ' Test requirements for <b>' + dest.name + '</b></span>'
        + '<button class="mt-cl-btn" onclick="bridgeToCentres(\'' + dest.id + '\')">🗺️ View '
        + (n != null ? n + ' ' : '') + 'centres empanelled for ' + progLabel + ' →</button>'
        + note
        + '</div>';
      el.style.display = 'block';
      return;
    }
  }
  el.innerHTML = '';
  el.style.display = 'none';
}

/* ─── Chips ─── */
function renderChips() {
  const section = document.getElementById('chipSection');

  if (mode === 'country') {
    const label = '<div class="chip-section-label">Select countries (multi-select)</div>';
    const chips = COUNTRIES.map((c, i) => {
      const sel = selectedCountries.has(i) ? ' selected' : '';
      const cnt = allTests().filter(t => t.req[i] >= 1).length;
      return `<div class="chip${sel}" onclick="MT.toggleCountry(${i})">
        <span class="flag">${c.flag}</span>${c.name}<span class="count">${cnt}</span>
      </div>`;
    }).join('');
    const quickCompareRow = `<div class="quick-compare">
      <span class="quick-compare-label">Quick compare:</span>
      <button class="qc-btn" onclick="MT.quickCompare([0,1])">🇦🇺 AU + 🇳🇿 NZ</button>
      <button class="qc-btn" onclick="MT.quickCompare([3,4])">🌐 GCC + 🇦🇪 Abu Dhabi</button>
      <button class="qc-btn" onclick="MT.quickCompare([0,3])">🇦🇺 AU + 🌐 GCC</button>
    </div>`;
    section.innerHTML = label + '<div class="chip-row">' + chips + '</div>' + quickCompareRow;
  } else {
    _chipGroups = [];
    const label = '<div class="chip-section-label">Click a card header to select all tests in that group, or tick individual tests</div>';

    // Build category → sub-category → test hierarchy
    const catGroups = [];
    let curCat = null, curSub = null;
    DATA.forEach(d => {
      if (d.type === 'cat') {
        curCat = { catName: d.name, icon: d.icon, subs: [], direct: [] };
        curSub = null;
        catGroups.push(curCat);
      } else if (d.type === 'sub') {
        curSub = { subName: d.name, tests: [] };
        if (curCat) curCat.subs.push(curSub);
      } else if (d.type === 'test') {
        if (searchTerm && !d.name.toLowerCase().includes(searchTerm)) return;
        if (curSub) curSub.tests.push(d);
        else if (curCat) curCat.direct.push(d);
      }
    });

    const checkSvg = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5 3.5-4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const renderCard = (groupName, tests, icon) => {
      if (!tests.length) return '';
      const names = tests.map(t => t.name);
      const gi = _chipGroups.length;
      _chipGroups.push(names);
      const selCount = names.filter(n => selectedTests.has(n)).length;
      const allSel = selCount === names.length;
      const someSel = selCount > 0 && !allSel;
      const cardCls = allSel ? 'all-selected' : someSel ? 'partial' : '';
      const iconEmoji = icon === 'rad' ? '🔬' : icon === 'lab' ? '🧪' : '💉';

      let out = `<div class="test-card ${cardCls} cat-${icon}">`;
      out += `<div class="card-header" onclick="MT.toggleGroup(${gi})">
        <div class="card-header-left">
          <div class="card-icon ${icon}">${iconEmoji}</div>
          <span class="card-title">${groupName}</span>
        </div>
        <span class="card-count">${selCount}/${names.length}</span>
      </div>`;
      out += '<div class="card-items">';
      tests.forEach(t => {
        const sel = selectedTests.has(t.name) ? ' sel' : '';
        out += `<div class="card-item${sel}" onclick="MT.toggleTest('${t.name.replace(/'/g, "\\'")}')">
          <div class="item-check">${sel ? checkSvg : ''}</div>
          ${t.name}
        </div>`;
      });
      out += '</div></div>';
      return out;
    };

    let html = label + '<div class="card-grid">';
    catGroups.forEach(cat => {
      if (cat.direct.length) html += renderCard(cat.catName, cat.direct, cat.icon);
      cat.subs.forEach(sub => { html += renderCard(sub.subName, sub.tests, cat.icon); });
    });
    html += '</div>';
    section.innerHTML = html;
  }
}

/* ─── Stats (insight banner) ─── */
function renderStats() {
  const row = document.getElementById('statsRow');
  const tests = allTests();

  const ic = (color, emoji, headline, desc, action = '') =>
    `<div class="insight-card${action ? ' clickable' : ''}"${action ? ` onclick="${action}"` : ''}>
      <div class="insight-icon ${color}">${emoji}</div>
      <div><div class="insight-headline ${color}">${headline}</div>
      <div class="insight-desc">${desc}</div></div>
    </div>`;

  if (mode === 'country' && selectedCountries.size > 0) {
    const idx = [...selectedCountries];
    const allReq  = tests.filter(t => idx.every(i => t.req[i] >= 1)).length;
    const anyReq  = tests.filter(t => idx.some(i => t.req[i] >= 1)).length;
    const fuOnly  = tests.filter(t => idx.some(i => t.req[i] === 2) && idx.every(i => t.req[i] !== 1)).length;
    const cNames  = idx.map(i => COUNTRIES[i].name);
    const cStr    = cNames.length === 2 ? `${cNames[0]} &amp; ${cNames[1]}` : `${cNames.length} selected`;
    row.innerHTML =
      ic('green', '✅', allReq,        `tests required by <strong>all</strong> selected (${cStr})`) +
      ic('blue',  '📊', anyReq,        `total tests required by <strong>any</strong> selected country`) +
      ic('amber', '🔄', fuOnly,        `conditional / follow-up only tests`) +
      ic('grey',  '🧪', tests.length,  `total tests in database`);

  } else if (mode === 'test' && selectedTests.size > 0) {
    const selObjs     = tests.filter(t => selectedTests.has(t.name));
    const allCountries = COUNTRIES.filter((_, i) => selObjs.every(t => t.req[i] >= 1)).length;
    const anyCountry  = COUNTRIES.filter((_, i) => selObjs.some(t => t.req[i] >= 1)).length;
    row.innerHTML =
      ic('green', '🌍', allCountries,    `countries require <strong>all</strong> selected tests`) +
      ic('blue',  '📍', anyCountry,      `countries require <strong>at least one</strong> selected test`) +
      ic('amber', '📌', selectedTests.size, `tests currently selected`) +
      ic('grey',  '🗺️', COUNTRIES.length, `countries tracked in database`);

  } else {
    const universal  = tests.filter(t => t.req.every(v => v >= 1)).length;
    const byCountry  = COUNTRIES.map((c, i) => ({ name: c.name, flag: c.flag, count: tests.filter(t => t.req[i] >= 1).length }));
    const top        = byCountry.reduce((a, b) => a.count > b.count ? a : b);
    const topIdx     = byCountry.indexOf(top);
    const auNz       = tests.filter(t => t.req[0] >= 1 && t.req[1] >= 1).length;
    row.innerHTML =
      ic('green', '🔒', universal,     `tests required by <strong>all 5 countries</strong> — universal baseline`, 'MT.showUniversalTests()') +
      ic('amber', '📋', top.count,     `${top.flag} <strong>${top.name}</strong> has the highest test count`, `MT.selectCountry(${topIdx})`) +
      ic('blue',  '🤝', auNz,          `tests shared between <strong>Australia &amp; New Zealand</strong>`, 'MT.quickCompare([0,1])') +
      ic('grey',  '🧪', tests.length,  `total tests tracked across all 5 countries`, 'MT.clearAll()');
  }
}

/* ─── Table ─── */
function renderTable() {
  const table = document.getElementById('mainTable');
  const info = document.getElementById('resultsInfo');

  const visibleCountryIndices = selectedCountries.size > 0 && mode === 'country'
    ? [...selectedCountries]
    : COUNTRIES.map((_, i) => i);

  let visibleTests;
  if (mode === 'country' && selectedCountries.size > 0) {
    visibleTests = new Set(
      allTests()
        .filter(t => [...selectedCountries].some(i => t.req[i] >= 1))
        .map(t => t.name)
    );
  } else if (mode === 'test' && selectedTests.size > 0) {
    visibleTests = new Set(selectedTests);
  } else if (searchTerm) {
    visibleTests = new Set(
      allTests()
        .filter(t => t.name.toLowerCase().includes(searchTerm))
        .map(t => t.name)
    );
  } else {
    visibleTests = new Set(allTests().map(t => t.name));
  }

  const countryHeaders = mode === 'country' && selectedCountries.size > 0
    ? [...selectedCountries]
    : COUNTRIES.map((_, i) => i);

  let thead = '<thead><tr><th>Test / examination</th>';
  countryHeaders.forEach(i => {
    thead += `<th><span class="th-id">${COUNTRIES[i].id}</span><span class="th-name">${COUNTRIES[i].name}</span></th>`;
  });
  thead += '</tr></thead>';

  let tbody = '<tbody>';
  let hasRows = false;
  let lastCat = null;
  let lastSub = null;
  let catHasVisibleTests = false;
  let subHasVisibleTests = false;

  const bufferedCat = [];
  const bufferedSub = [];

  DATA.forEach((d, idx) => {
    if (d.type === 'cat') {
      bufferedCat.length = 0;
      bufferedCat.push(d);
      bufferedSub.length = 0;
    } else if (d.type === 'sub') {
      bufferedSub.length = 0;
      bufferedSub.push(d);
    } else if (d.type === 'test' && visibleTests.has(d.name)) {
      if (bufferedCat.length > 0) {
        const c = bufferedCat[0];
        tbody += `<tr class="cat cat-${c.icon || ''}"><td colspan="${countryHeaders.length + 1}"><span class="cat-icon ${c.icon || ''}">${
          c.icon === 'rad' ? '🔬' : c.icon === 'lab' ? '🧪' : '💉'
        }</span>${c.name}</td></tr>`;
        bufferedCat.length = 0;
      }
      if (bufferedSub.length > 0) {
        const s = bufferedSub[0];
        tbody += `<tr class="sub"><td colspan="${countryHeaders.length + 1}">${s.name}</td></tr>`;
        bufferedSub.length = 0;
      }

      tbody += `<tr class="test" onclick="MT.showDetail('${d.name.replace(/'/g, "\\'")}')">`;
      tbody += `<td><div class="test-name">${d.name}</div></td>`;
      if (tableView === 'heatmap') {
        countryHeaders.forEach(ci => {
          const v = d.req[ci];
          tbody += `<td><span class="hm-sq ${v === 1 ? 'req' : v === 2 ? 'fu' : 'nr'}"></span></td>`;
        });
      } else {
        countryHeaders.forEach(ci => {
          const v = d.req[ci];
          if (v === 1) tbody += '<td><span class="badge yes">Required</span></td>';
          else if (v === 2) {
            const infoBtn = d.trigger
              ? `<i class="fu-info" data-trigger="${d.trigger}" data-note="${d.triggerNote || ''}" onmouseenter="MT.showFuTooltip(event)" onmouseleave="MT.hideFuTooltip()">i</i>`
              : '';
            tbody += `<td><span class="badge followup">Follow-up</span>${infoBtn}</td>`;
          }
          else tbody += '<td><span class="badge no">—</span></td>';
        });
      }
      tbody += '</tr>';
      hasRows = true;
    }
  });

  tbody += '</tbody>';

  if (!hasRows) {
    table.innerHTML = thead + '<tbody><tr><td colspan="' + (countryHeaders.length + 1) + '"><div class="empty-state"><svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg><div>No tests match your current filters</div></td></tr></tbody>';
  } else {
    table.innerHTML = thead + tbody;
  }

  const total = visibleTests.size;
  const legend = `<div class="legend">
    <span class="legend-item"><span class="legend-dot" style="background:var(--green-bg);border:1px solid var(--green-border)"></span>Required</span>
    <span class="legend-item"><span class="legend-dot" style="background:var(--amber-bg);border:1px solid var(--amber-border)"></span>Follow-up</span>
    <span class="legend-item"><span class="legend-dot" style="background:var(--surface-alt);border:1px solid var(--border)"></span>Not required</span>
  </div>`;
  const viewToggle = `<div class="view-toggle">
    <button ${tableView === 'table' ? 'class="active"' : ''} onclick="MT.setTableView('table')">≡ Table</button>
    <button ${tableView === 'heatmap' ? 'class="active"' : ''} onclick="MT.setTableView('heatmap')">⊞ Heatmap</button>
  </div>`;
  info.innerHTML = `<span>Showing <strong>${total}</strong> of ${allTests().length} tests${selectedCountries.size > 0 ? ' across <strong>' + selectedCountries.size + '</strong> countries' : ''}${selectedTests.size > 0 ? ' — <strong>' + selectedTests.size + '</strong> selected' : ''}</span>${viewToggle}${legend}`;
}

/* ─── Follow-up tooltip ─── */
function showFuTooltip(e) {
  const trigger = e.target.dataset.trigger;
  const note    = e.target.dataset.note;
  const tt      = document.getElementById('fuTooltip');
  tt.innerHTML  = `<div class="tt-label">Triggered by</div>
    <div class="tt-chip">${trigger}</div>
    ${note ? `<div class="tt-note">${note}</div>` : ''}`;
  const rect    = e.target.getBoundingClientRect();
  tt.style.left = Math.max(8, rect.left + rect.width / 2 - 120) + 'px';
  tt.style.top  = (rect.top - 8) + 'px';
  tt.style.transform = 'translateY(-100%)';
  tt.classList.add('visible');
}
function hideFuTooltip() {
  document.getElementById('fuTooltip').classList.remove('visible');
}

/* ─── Detail panel ─── */
function showDetail(name) {
  const t = allTests().find(x => x.name === name);
  if (!t) return;
  const panel = document.getElementById('detailPanel');
  document.getElementById('detailTitle').textContent = t.name;

  const grid = document.getElementById('detailGrid');
  grid.innerHTML = COUNTRIES.map((c, i) => {
    const v = t.req[i];
    const cls = v === 1 ? 'req' : v === 2 ? 'fu' : 'nr';
    const status = v === 1 ? 'Required' : v === 2 ? 'Follow-up only' : 'Not required';
    return `<div class="detail-card ${cls}"><div class="dc-country">${c.flag} ${c.name}</div><div class="dc-status">${status}</div></div>`;
  }).join('');

  const meta = document.getElementById('detailMeta');
  let html = '';

  const op = OP_DATA[t.name];
  if (op) {
    const machineBadge = op.machine === 'Yes'
      ? `<span class="machine-badge available">&#10003; Available</span>`
      : op.machine === 'Manual'
        ? `<span class="machine-badge manual">&#9881; Manual</span>`
        : op.machine === 'Outsourced'
          ? `<span class="machine-badge outsourced">&#8599; Outsourced</span>`
          : `<span class="op-field-value muted">—</span>`;

    html += `<div class="op-divider"><span class="op-divider-label">Operational Readiness</span><div class="op-divider-line"></div><span class="op-new-tag">From Excel</span></div>`;
    html += `<div class="op-grid">
      <div class="op-field"><div class="op-field-label">Machine at ND Kochi</div><div class="op-field-value">${machineBadge}</div></div>
      <div class="op-field"><div class="op-field-label">Machine Cost</div><div class="op-field-value muted">—</div></div>
      <div class="op-field"><div class="op-field-label">Suggested Price</div><div class="op-field-value green">${op.price ? op.price.startsWith('₹') || op.price.includes('/') ? op.price : '&#8377; ' + op.price : '—'}</div></div>
      <div class="op-field"><div class="op-field-label">Cost / Test (INR)</div><div class="op-field-value blue">${op.cost ? op.cost.toString().startsWith('₹') || op.cost.toString().includes('/') || op.cost.toString().includes(':') ? op.cost : '&#8377; ' + op.cost : '—'}</div></div>
    </div>`;
    if (op.remarks) html += `<div class="op-block"><div class="op-field-label">Remarks (ND Kochi)</div><div class="op-block-text">${op.remarks}</div></div>`;
  }

  // Build per-country notes map: only AD has data now; others pending
  window._cnNotes = {
    AU: null,
    NZ: null,
    MY: null,
    GCC: null,
    AD: (op && op.adNote) ? op.adNote : null,
  };
  // Merge t.note into relevant country if it looks country-specific
  if (t.note) {
    // t.note is a general regulatory note — store under a special key shown in the dropdown
    window._cnNotes._general = t.note;
  }
  const defaultCN = Object.keys(window._cnNotes).find(k => window._cnNotes[k] && k !== '_general') || 'AU';
  const cnOptions = COUNTRIES.map(c =>
    `<option value="${c.id}"${c.id === defaultCN ? ' selected' : ''}>${c.flag} ${c.name}</option>`
  ).join('');
  const cnInitial = window._cnNotes[defaultCN]
    ? `<span class="op-block-text">${window._cnNotes[defaultCN]}</span>`
    : `<span class="cn-pending">Data pending — awaiting response from authority.</span>`;

  html += `<div class="op-block">
    <div class="cn-header">
      <div class="op-field-label">Country-specific notes</div>
      <select class="cn-select" onchange="MT.updateCN(this.value)">${cnOptions}</select>
    </div>
    <div class="cn-body" id="cnBody">${cnInitial}</div>
  </div>`;

  if (t.note) html += `<div class="op-block"><div class="op-field-label">Regulatory notes</div><div class="op-block-text">${t.note}</div></div>`;

  meta.innerHTML = html;
  panel.classList.add('open');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ─── Country notes dropdown ─── */
function updateCN(countryId) {
  const body = document.getElementById('cnBody');
  if (!body) return;
  const note = (window._cnNotes || {})[countryId];
  body.innerHTML = note
    ? `<span class="op-block-text">${note}</span>`
    : `<span class="cn-pending">Data pending — awaiting response from authority.</span>`;
}

/* ─── Theme toggle ─── */
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.getElementById('themeToggle').textContent = next === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('medDashTheme', next); } catch(e) {}
  render();
}

(function() {
  let saved = 'light';
  try { saved = localStorage.getItem('medDashTheme') || 'light'; } catch(e) {}
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.addEventListener('DOMContentLoaded', function() {
      const btn = document.getElementById('themeToggle');
      if (btn) btn.textContent = '☀️';
    });
  }
})();

render();

window.MT = { setMode, onSearch, clearAll, toggleCountry, toggleTest, toggleGroup, setTableView, quickCompare, showUniversalTests, selectCountry, selectDestById, testsForDest, showDetail, showFuTooltip, hideFuTooltip, updateCN, toggleTheme, _render: render };
})();
