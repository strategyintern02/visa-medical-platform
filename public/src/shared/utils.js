// utils.js — shared DOM + formatting helpers (extracted from the map IIFE, Phase 4).
export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
export const fmt = n => (n == null ? '—' : n.toLocaleString());
export const escapeHTML = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
export const pct = (n, d) => d ? (Math.round((n / d) * 1000) / 10).toFixed(1) : '0.0';
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); } }
