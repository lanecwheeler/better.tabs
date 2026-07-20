'use strict';

const COLOR_HEX = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025',
  yellow: '#f9ab00', green: '#137333', pink: '#d01884',
  purple: '#a142f4', cyan: '#007b83', orange: '#e37400'
};

// Inline-SVG icon markup referencing a <symbol> in the sprite baked into
// popup.html. Self-contained — no external icon font. See #icon-sprite there.
function icon(name, cls = '') {
  return `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

// ── Settings ────────────────────────────────────────────────────────────────
// Persisted in localStorage, which the popup, pop-out, and options page all
// share (same extension origin). Theme lives under its own 'theme' key.

function getDefaultScope() {
  return localStorage.getItem('defaultScope') === 'all' ? 'all' : 'current';
}

// Whether starred domains are pinned to the top of the list in every view.
function getPinFavorites() {
  return localStorage.getItem('pinFavorites') !== 'false';   // default on
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showStatus(msg, type) {
  const bar = document.getElementById('status-bar');
  bar.innerHTML = `<div class="status ${type}">${escHtml(msg)}</div>`;
  setTimeout(() => { bar.innerHTML = ''; }, 3500);
}

function getRealUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'chrome-extension:') {
      const inner = parsed.searchParams.get('url');
      return inner || null;
    }
    if (/^(chrome|about|data|blob):/.test(parsed.protocol)) return null;
    return rawUrl;
  } catch {
    return null;
  }
}

function getDisplayTitle(tab) {
  if (!tab.url) return tab.title || 'Untitled';
  try {
    const parsed = new URL(tab.url);
    if (parsed.protocol === 'chrome-extension:') {
      const paramTitle = parsed.searchParams.get('title');
      if (paramTitle?.trim()) return paramTitle.trim();
      const realUrlStr = parsed.searchParams.get('url');
      if (realUrlStr) {
        const decoded = decodeURIComponent(realUrlStr);
        try {
          const u = new URL(decoded);
          const path = u.pathname + u.search;
          return path.length > 1 ? u.hostname + path : u.hostname;
        } catch {
          return decoded;
        }
      }
    }
  } catch { /* malformed */ }
  return tab.title || tab.url || 'Untitled';
}

// ── Favorite domains ─────────────────────────────────────────────────────────
// Persisted (like the theme) in localStorage, which the toolbar popup and the
// pop-out window share since both load popup.html.

const FAVORITES_KEY = 'favoriteDomains';

function getFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function isFavorite(domain) {
  return getFavorites().has(domain);
}

// Flip a domain's favorite state and persist; returns its new state.
function toggleFavorite(domain) {
  const favs = getFavorites();
  if (favs.has(domain)) favs.delete(domain);
  else                  favs.add(domain);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
  return favs.has(domain);
}

function getExpandedDomains() {
  const expanded = new Set();
  document.querySelectorAll('#domain-list .domain-group').forEach(grp => {
    if (grp.querySelector('.expand-btn')?.getAttribute('aria-expanded') === 'true') {
      expanded.add(grp.dataset.domain);
    }
  });
  return expanded;
}

function restoreExpandedDomains(expandedSet) {
  if (!expandedSet.size) return;
  document.querySelectorAll('#domain-list .domain-group').forEach(grp => {
    if (expandedSet.has(grp.dataset.domain)) {
      grp.querySelector('.expand-btn').setAttribute('aria-expanded', 'true');
      grp.querySelector('.tab-rows').hidden = false;
    }
  });
}

// Tab checkboxes are keyed by tab id, which survives a rebuild (a tab keeps its
// id when it starts playing audio, gets muted, etc.), so selections can be
// carried across the live refreshes those events trigger.
function getSelectedTabIds() {
  const ids = new Set();
  document.querySelectorAll('#domain-list .tab-cb:checked').forEach(cb => {
    ids.add(cb.dataset.tabId);
  });
  return ids;
}

function restoreSelectedTabIds(selectedSet) {
  if (!selectedSet.size) return;
  document.querySelectorAll('#domain-list .tab-cb').forEach(cb => {
    if (selectedSet.has(cb.dataset.tabId)) cb.checked = true;
  });
  // Re-derive the domain and select-all checkbox states from the restored rows.
  document.querySelectorAll('#domain-list .domain-group').forEach(grp => {
    syncDomainCheckbox(grp.querySelector('.domain-cb'), grp.querySelector('.tab-rows'));
  });
  syncSelectAll();
}
