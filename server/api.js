/*
  Visa Medical Centre Intelligence Platform — Server
  --------------------------------------------------
  Local:   node server.js  →  http://localhost:3000
  Vercel:  module.exports = app  (no listen)

  Persistence:
    - When GIST_ID + GITHUB_TOKEN env vars are set → GitHub Gist (Vercel)
    - Otherwise → data.json on disk (local dev)
*/

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app      = express();
const PORT     = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');
const DB_PATH  = path.join(ROOT_DIR, 'data', 'data.json');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const HTML_FILE = path.join(PUBLIC_DIR, 'index.html');

const GIST_ID      = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_FILENAME = 'data.json';

// ── Database helpers ──────────────────────────────────────────────────────────

async function readDB() {
  if (GIST_ID && GITHUB_TOKEN) {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'VisaMedicalIntelligencePlatform/1.0'
      }
    });
    if (!res.ok) throw new Error('GitHub Gist read failed: ' + res.status);
    const gist = await res.json();
    const file = gist.files[GIST_FILENAME];
    if (!file) throw new Error(`File "${GIST_FILENAME}" not found in gist`);
    // Large gists are truncated — fetch raw content if needed
    const content = file.truncated
      ? await (await fetch(file.raw_url)).text()
      : file.content;
    return JSON.parse(content);
  }
  // Local dev fallback
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
}

async function writeDB(data) {
  const content = JSON.stringify(data, null, 2);
  if (GIST_ID && GITHUB_TOKEN) {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'VisaMedicalIntelligencePlatform/1.0'
      },
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
    });
    if (!res.ok) throw new Error('GitHub Gist write failed: ' + res.status);
    return;
  }
  // Local dev fallback
  fs.writeFileSync(DB_PATH, content, 'utf8');
}

// Write queue (mutex) so concurrent POST/PUT requests never interleave their
// read-modify-write cycles.
let _dbQueue = Promise.resolve();

function withDB(fn) {
  const result = _dbQueue.then(fn);
  _dbQueue = result.catch(() => {});
  return result;
}

// ── Geocoding (city-level coordinates via OpenStreetMap Nominatim) ────────────

async function geocodeCity(city, country) {
  try {
    const q   = `${encodeURIComponent(city)},${encodeURIComponent(country)}`;
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=0`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VisaMedicalIntelligencePlatform/1.0 (internal)' }
    });
    if (!res.ok) throw new Error('Nominatim returned ' + res.status);
    const hits = await res.json();
    if (Array.isArray(hits) && hits.length > 0) {
      return {
        lat: parseFloat(hits[0].lat),
        lng: parseFloat(hits[0].lon),
        coordConfidence: 'city-level coordinate'
      };
    }
  } catch (e) {
    console.warn('  Geocoding failed for', city, country, '—', e.message);
  }
  return { lat: null, lng: null, coordConfidence: 'not geocoded' };
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(HTML_FILE);
});

// Only serve files under public/. Data, server code, scripts, and node_modules
// live outside this folder and are therefore not reachable from the browser.
app.use(express.static(PUBLIC_DIR));

// ── API Routes ────────────────────────────────────────────────────────────────

/* GET /api/centres */
app.get('/api/centres', async (req, res) => {
  try {
    const db = await readDB();
    db.centres.forEach(c => {
      if (!Array.isArray(c.programs))                                            c.programs = [];
      if (!c.programStatuses || typeof c.programStatuses !== 'object'
          || Array.isArray(c.programStatuses))                                   c.programStatuses = {};
      if (c.lat  !== null && typeof c.lat  !== 'number') c.lat  = parseFloat(c.lat)  || null;
      if (c.lng  !== null && typeof c.lng  !== 'number') c.lng  = parseFloat(c.lng)  || null;
    });
    res.json({ centres: db.centres, wafidDemand: db.wafidDemand || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not read database: ' + e.message });
  }
});

/* POST /api/centres */
app.post('/api/centres', async (req, res) => {
  try {
    const { name, city, country, sourceCountry, programs, address, contact, email, remarks } = req.body;

    if (!name || !city || !country || !sourceCountry || !address) {
      return res.status(400).json({ error: 'Missing required fields (name, city, country, sourceCountry, programs, address)' });
    }
    if (!Array.isArray(programs) || programs.length === 0) {
      return res.status(400).json({ error: 'programs must be a non-empty array of programme names' });
    }

    const toTitleCase = s => (s || '').trim().replace(/\b\w/g, c => c.toUpperCase());
    const normName          = toTitleCase(name);
    const normCity          = toTitleCase(city);
    const normCountry       = toTitleCase(country);
    const normSourceCountry = toTitleCase(sourceCountry);

    console.log(`  Geocoding: ${normCity}, ${normCountry} ...`);
    const geo = await geocodeCity(normCity, normCountry);
    if (geo.lat) {
      console.log(`  ✓ Coordinates found: ${geo.lat}, ${geo.lng}`);
    } else {
      console.log(`  ⚠ No coordinates found — centre will appear without map marker`);
    }

    const id = 'MC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const programStatuses = {};
    programs.forEach(p => { programStatuses[p] = 'New Empanelment'; });

    const newCentre = {
      id,
      name:          normName,
      category: 'Medical Centre',
      sourceCountry: normSourceCountry,
      country:       normCountry,
      city:          normCity,
      state: '',
      address,
      programs: [...programs],
      programStatuses,
      status: 'New Empanelment',
      m5PanelCount: 0,
      totalEmpanelment: 1,
      contact:  contact  || '',
      email:    email    || '',
      website:  '',
      lat:      geo.lat,
      lng:      geo.lng,
      coordConfidence:   geo.coordConfidence,
      validationStatus:  'Verified by operations team',
      validationChannel: 'Internal verification',
      remarks:  remarks  || '',
    };

    await withDB(async () => {
      const db = await readDB();

      const nameLower   = normName.toLowerCase();
      const cityLower   = normCity.toLowerCase();
      const sourceLower = normSourceCountry.toLowerCase();

      const existing = db.centres.find(c =>
        c.name.toLowerCase()          === nameLower &&
        c.city.toLowerCase()          === cityLower &&
        c.sourceCountry.toLowerCase() === sourceLower
      );

      if (existing) {
        const status = existing.status;
        const err = new Error(
          status === 'De-panelled'
            ? `"${existing.name}" in ${existing.city} already exists and is currently De-panelled. ` +
              `Use the Re-empanel option in the Update tab to restore it.`
            : `"${existing.name}" in ${existing.city} already exists (status: ${status}). ` +
              `Duplicate entries are not allowed.`
        );
        err.statusCode = 409;
        throw err;
      }

      db.centres.push(newCentre);
      await writeDB(db);
    });

    console.log(`  ✓ New centre saved: ${normName} (${normCity}, ${normCountry})`);
    res.status(201).json(newCentre);

  } catch (e) {
    console.error(e);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/* PUT /api/centres/:id/depanel */
app.put('/api/centres/:id/depanel', async (req, res) => {
  try {
    const { programme, remarks } = req.body;
    if (!programme) return res.status(400).json({ error: 'programme is required' });

    let updatedCentre;

    await withDB(async () => {
      const db     = await readDB();
      const centre = db.centres.find(c => c.id === req.params.id);
      if (!centre) {
        const err = new Error('Centre not found');
        err.statusCode = 404;
        throw err;
      }

      if (!centre.programs.includes(programme)) {
        const err = new Error(`Programme "${programme}" is not listed for this centre`);
        err.statusCode = 400;
        throw err;
      }

      centre.programStatuses[programme] = 'De-panelled';

      if (remarks) {
        centre.remarks = (centre.remarks ? centre.remarks + '\n' : '')
                       + `De-panel [${programme}]: ${remarks}`;
      }

      const allDepanelled = centre.programs.every(
        p => (centre.programStatuses[p] || centre.status) === 'De-panelled'
      );
      if (allDepanelled) centre.status = 'De-panelled';

      await writeDB(db);
      updatedCentre = centre;
    });

    console.log(`  ✓ De-panelled: ${updatedCentre.name} from ${programme}`);
    res.json(updatedCentre);

  } catch (e) {
    console.error(e);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/* PUT /api/centres/:id/reempanel */
app.put('/api/centres/:id/reempanel', async (req, res) => {
  try {
    const { programme, remarks } = req.body;
    if (!programme) return res.status(400).json({ error: 'programme is required' });

    let updatedCentre;

    await withDB(async () => {
      const db     = await readDB();
      const centre = db.centres.find(c => c.id === req.params.id);
      if (!centre) {
        const err = new Error('Centre not found');
        err.statusCode = 404;
        throw err;
      }

      if (!centre.programs.includes(programme)) {
        const err = new Error(`Programme "${programme}" is not listed for this centre`);
        err.statusCode = 400;
        throw err;
      }

      if ((centre.programStatuses[programme] || centre.status) !== 'De-panelled') {
        const err = new Error(`Programme "${programme}" is not currently De-panelled for this centre`);
        err.statusCode = 400;
        throw err;
      }

      centre.programStatuses[programme] = 'New Empanelment';

      const stillDepanelled = centre.programs.some(
        p => (centre.programStatuses[p] || centre.status) === 'De-panelled'
      );
      if (!stillDepanelled) centre.status = 'New Empanelment';

      if (remarks) {
        centre.remarks = (centre.remarks ? centre.remarks + '\n' : '')
                       + `Re-empanelled [${programme}]: ${remarks}`;
      }

      await writeDB(db);
      updatedCentre = centre;
    });

    console.log(`  ✓ Re-empanelled: ${updatedCentre.name} for ${programme}`);
    res.json(updatedCentre);

  } catch (e) {
    console.error(e);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// ── Snapshot helpers (baseline for test-mode revert) ─────────────────────────

const SNAPSHOT_FILENAME = 'data-snapshot.json';
const SNAPSHOT_PATH     = path.join(ROOT_DIR, 'data', 'data-snapshot.json');

async function readSnapshot() {
  if (GIST_ID && GITHUB_TOKEN) {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'VisaMedicalIntelligencePlatform/1.0'
      }
    });
    if (!res.ok) throw new Error('GitHub Gist read failed: ' + res.status);
    const gist = await res.json();
    const file = gist.files[SNAPSHOT_FILENAME];
    if (!file) return null;
    const content = file.truncated
      ? await (await fetch(file.raw_url)).text()
      : file.content;
    return JSON.parse(content);
  }
  if (!fs.existsSync(SNAPSHOT_PATH)) return null;
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
}

async function writeSnapshot(data) {
  const snapshot = { ...data, _snapshotSavedAt: new Date().toISOString() };
  const content  = JSON.stringify(snapshot, null, 2);
  if (GIST_ID && GITHUB_TOKEN) {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'VisaMedicalIntelligencePlatform/1.0'
      },
      body: JSON.stringify({ files: { [SNAPSHOT_FILENAME]: { content } } })
    });
    if (!res.ok) throw new Error('GitHub Gist snapshot write failed: ' + res.status);
    return;
  }
  fs.writeFileSync(SNAPSHOT_PATH, content, 'utf8');
}

/* GET /api/snapshot/status — does a baseline exist, and when was it saved? */
app.get('/api/snapshot/status', async (req, res) => {
  try {
    const snapshot = await readSnapshot();
    if (!snapshot) return res.json({ exists: false });
    res.json({
      exists:  true,
      savedAt: snapshot._snapshotSavedAt || null,
      count:   Array.isArray(snapshot.centres) ? snapshot.centres.length : 0
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* POST /api/snapshot — save current data.json as a baseline */
app.post('/api/snapshot', async (req, res) => {
  try {
    const db      = await readDB();
    const savedAt = new Date().toISOString();
    await writeSnapshot(db);
    res.json({ ok: true, savedAt, count: Array.isArray(db.centres) ? db.centres.length : 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* POST /api/revert — restore data.json from the saved baseline */
app.post('/api/revert', async (req, res) => {
  try {
    const snapshot = await readSnapshot();
    if (!snapshot) {
      return res.status(404).json({ error: 'No baseline snapshot found. Save a baseline first.' });
    }
    const { _snapshotSavedAt, ...data } = snapshot;
    await writeDB(data);
    res.json({ ok: true, count: Array.isArray(data.centres) ? data.centres.length : 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Startup: normalise capitalisation on saved data ───────────────────────────
(async function normaliseSavedData() {
  try {
    const toTC = s => (s || '').trim().replace(/\b\w/g, c => c.toUpperCase());
    const db   = await readDB();
    let changed = 0;
    db.centres.forEach(c => {
      let dirty = false;

      const fixedCity   = toTC(c.city);
      const fixedSource = toTC(c.sourceCountry);
      const fixedName   = toTC(c.name);
      if (c.city !== fixedCity)           { c.city          = fixedCity;   dirty = true; }
      if (c.sourceCountry !== fixedSource){ c.sourceCountry = fixedSource; dirty = true; }
      if (c.name !== fixedName)           { c.name          = fixedName;   dirty = true; }
      if (c.country) {
        const fixedCountry = toTC(c.country);
        if (c.country !== fixedCountry)   { c.country = fixedCountry;      dirty = true; }
      }

      if (c.validationChannel === 'Manual entry') {
        c.validationStatus  = 'Verified by operations team';
        c.validationChannel = 'Internal verification';
        dirty = true;
      }

      if (dirty) changed++;
    });
    if (changed > 0) {
      await writeDB(db);
      console.log(`  ✓ Normalised capitalisation on ${changed} record(s)`);
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn('  ℹ data.json not found — will be created on first entry.');
    } else {
      console.warn('  ⚠ Could not normalise data on startup:', e.message);
    }
  }
})();

// ── Export for Vercel (serverless); listen only when run directly ─────────────

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('\n  ┌────────────────────────────────────────────────┐');
    console.log(`  │  Visa Medical Intelligence Platform            │`);
    console.log(`  │  http://localhost:${PORT}                         │`);
    console.log('  └────────────────────────────────────────────────┘');
    console.log('\n  Open the link above in your browser.\n');
  });
}
