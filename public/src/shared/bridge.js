// bridge.js — shared view layer: the top-bar view switcher + the cross-jumps
// between Centre Map and Test Requirements. Depends only on the taxonomy.
import { DEST_TAXONOMY } from './taxonomy.js';

// Toggle between the two top-level views.
function switchView(v) {
  var app = document.getElementById('app');
  app.classList.toggle('view-tests', v === 'tests');
  document.querySelectorAll('.view-switch button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.view === v);
  });
  if (v === 'tests') {
    if (window.MT && window.MT._render) window.MT._render();
  } else {
    // Returning to the map: the Leaflet container was display:none, so it needs
    // a resize AFTER layout settles or tiles stay grey. Defer past paint + a fallback.
    var redraw = function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} };
    requestAnimationFrame(function () { requestAnimationFrame(redraw); });
    setTimeout(redraw, 120);
  }
}

// Test Requirements -> Centre Map (filter centres to this destination's programme).
function bridgeToCentres(destId) {
  var prog = DEST_TAXONOMY.programmeByDest[destId];
  switchView('map');
  if (window.VMP && prog) window.VMP.filterByProgramme(prog);
}

// Expose globally for the inline on* handlers and the map/test view modules.
window.switchView = switchView;
window.bridgeToCentres = bridgeToCentres;

// Wire the top-bar view switcher.
document.querySelectorAll('.view-switch button').forEach(function (b) {
  b.addEventListener('click', function () { switchView(b.dataset.view); });
});
