// taxonomy.js — the join key between the two views.
// Maps a Centre Map programme <-> a Test Requirements destination id.
// Abu Dhabi (AD) rolls up to the WAFID programme.
// Taiwan (TW) and Cook Islands (CK) are test-only destinations — no centres exist for
// them on the map yet, so they're intentionally absent from this join. USA has centres
// but no test-requirements destination yet, so it's also intentionally absent.
export const DEST_TAXONOMY = {
  // map programme  ->  test-view destination id
  byProgramme:     { 'Australia': 'AU', 'New Zealand': 'NZ', 'Malaysia': 'MY', 'WAFID': 'GCC', 'Canada': 'CA', 'UK': 'UK', 'Japan': 'JP', 'South Korea': 'KR' },
  // test-view destination id  ->  centre programme (Abu Dhabi rolls up to WAFID)
  programmeByDest: { 'AU': 'Australia', 'NZ': 'New Zealand', 'MY': 'Malaysia', 'GCC': 'WAFID', 'AD': 'WAFID', 'CA': 'Canada', 'UK': 'UK', 'JP': 'Japan', 'KR': 'South Korea' }
};

// Also expose globally: the (still-classic) map + test IIFEs read `window.DEST_TAXONOMY`
// at runtime. They both guard against it being undefined, so the deferred-module timing
// is safe. Remove this line once both views are modules that import DEST_TAXONOMY directly.
window.DEST_TAXONOMY = DEST_TAXONOMY;
