'use strict';

// ── Scope selector ─────────────────────────────────────────────────────────

async function bindScope() {
  if (isPopout) {
    // Pop-out window: choose any open window — a dropdown when narrow, a
    // sidebar list (with window actions) when wide enough for 2 columns.
    document.getElementById('scope-toggle').hidden = true;
    const sel = document.getElementById('scope-select');
    sel.hidden = false;
    sel.addEventListener('change', e => setScope(e.target.value));
    bindWindowOptions();
    await refreshWindowControls();
  } else {
    // Toolbar popup: simple Current / All toggle. Reflect the configured default.
    const btns = document.querySelectorAll('#scope-toggle [data-scope]');
    btns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scope === scope);
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        scope = btn.dataset.scope;
        loadDomains();
      });
    });
  }
}

// Set the active scope and keep both controls (dropdown + sidebar list) and the
// window-action buttons in sync, then reload the tab list.
function setScope(value) {
  scope = value;

  const sel = document.getElementById('scope-select');
  if (sel) {
    sel.value = String(value);
    if (sel.selectedIndex < 0) { sel.value = 'all'; scope = 'all'; }
  }
  document.querySelectorAll('#window-list .window-item').forEach(item => {
    item.classList.toggle('active', item.dataset.scope === String(scope));
  });
  syncWindowOptions();
  loadDomains();
}

// "Bring to front" / "Close window" need a specific window selected.
function syncWindowOptions() {
  const specific = scope !== 'all';
  const focusBtn = document.getElementById('win-focus');
  const closeBtn = document.getElementById('win-close');
  if (focusBtn) focusBtn.disabled = !specific;
  if (closeBtn) closeBtn.disabled = !specific;
}

// (Re)load the open windows and rebuild both scope controls.
async function refreshWindowControls() {
  let windows = [];
  try {
    windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  } catch {}

  // If the selected window has since closed, fall back to All Windows.
  if (scope !== 'all' && !windows.some(w => String(w.id) === String(scope))) {
    scope = 'all';
  }

  populateScopeOptions(windows);
  populateWindowList(windows);
  syncWindowOptions();
}

// A window's label: its active tab's title (what the OS titles the window).
function windowLabel(win) {
  const active = win.tabs?.find(t => t.active) ?? win.tabs?.[0];
  let label = active ? getDisplayTitle(active) : `Window ${win.id}`;
  if (label.length > 60) label = label.slice(0, 59) + '…';
  return label;
}

// Dropdown control (narrow pop-out).
function populateScopeOptions(windows) {
  const sel = document.getElementById('scope-select');
  if (!sel) return;
  sel.innerHTML = '<option value="all">All Windows</option>';
  for (const win of windows) {
    let label = windowLabel(win);
    if (win.id === currentWindowId) label += ' (current)';
    const opt = document.createElement('option');
    opt.value = String(win.id);
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.value = String(scope);
  if (sel.selectedIndex < 0) sel.value = 'all';
}

// Sidebar list control (wide pop-out).
function populateWindowList(windows) {
  const listEl = document.getElementById('window-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  listEl.appendChild(buildWindowItem('all', 'All Windows', null));
  for (const win of windows) {
    listEl.appendChild(buildWindowItem(String(win.id), windowLabel(win), win));
  }
  listEl.querySelectorAll('.window-item').forEach(item => {
    item.classList.toggle('active', item.dataset.scope === String(scope));
  });
}

function buildWindowItem(value, label, win) {
  const btn = document.createElement('button');
  btn.className = 'window-item';
  btn.dataset.scope = value;
  const isCurrent = win && win.id === currentWindowId;
  btn.innerHTML = `
    <span class="win-label">${escHtml(label)}${isCurrent ? ' (current)' : ''}</span>
    ${win ? `<span class="win-count">${win.tabs?.length ?? 0}</span>` : ''}
  `;
  btn.addEventListener('click', () => setScope(value));
  return btn;
}

// ── Window actions (pop-out sidebar) ─────────────────────────────────────────

function bindWindowOptions() {
  document.getElementById('win-focus')?.addEventListener('click', async () => {
    if (scope === 'all') return;
    try {
      await chrome.windows.update(Number(scope), { focused: true, drawAttention: true });
    } catch (err) {
      showStatus(`Error: ${err.message}`, 'error');
    }
  });

  document.getElementById('win-close')?.addEventListener('click', async () => {
    if (scope === 'all') return;
    try {
      await chrome.windows.remove(Number(scope));
      setScope('all');             // the selected window is gone
      await refreshWindowControls();
    } catch (err) {
      showStatus(`Error: ${err.message}`, 'error');
    }
  });

  document.getElementById('win-move-selected')?.addEventListener('click', moveSelectedToNewWindow);
}

// Drag the divider between the window sidebar and the main column to resize it
// (wide pop-out only). The chosen width is remembered across sessions.
function bindSidebarResizer() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('window-sidebar');
  if (!resizer || !sidebar) return;

  const MIN = 150;
  let dragging = false, startX = 0, startWidth = 0;

  resizer.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    document.body.classList.add('resizing-sidebar');
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const layoutWidth = sidebar.parentElement.getBoundingClientRect().width;
    const max = Math.max(MIN, Math.min(460, layoutWidth - 220));  // keep the main column usable
    const width = Math.max(MIN, Math.min(max, startWidth + (e.clientX - startX)));
    sidebar.style.flexBasis = `${width}px`;
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing-sidebar');
    localStorage.setItem('sidebarWidth', sidebar.style.flexBasis);
  });

  const saved = localStorage.getItem('sidebarWidth');
  if (saved) sidebar.style.flexBasis = saved;
}

// Open the first tab in a fresh window, then pull the rest in after it.
// Shared by the pop-out sidebar button, the action bar, and the context menu.
async function moveTabsToNewWindow(ids) {
  if (ids.length === 0) return 0;
  const [first, ...rest] = ids;
  const win = await chrome.windows.create({ tabId: first });
  if (rest.length) await chrome.tabs.move(rest, { windowId: win.id, index: -1 });
  return ids.length;
}

async function moveSelectedToNewWindow() {
  const ids = selectedTabIds();
  if (ids.length === 0) {
    showStatus('Select at least one tab.', 'error');
    return;
  }
  try {
    const n = await moveTabsToNewWindow(ids);
    showStatus(`Moved ${n} tab${n !== 1 ? 's' : ''} to a new window.`, 'success');
    await refreshWindowControls();
    await loadDomains();
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  }
}

// ── Live updates ─────────────────────────────────────────────────────────────

let liveRefreshTimer = null;

// Keep the tab list in sync with the browser as tabs are opened, closed, or
// moved between windows — most useful in the popped-out window, which stays
// open while you work. (Title/URL changes are intentionally not watched, to
// avoid refreshing on every page load.)
function bindLiveUpdates() {
  chrome.tabs.onRemoved.addListener(scheduleLiveRefresh);
  chrome.tabs.onCreated.addListener(scheduleLiveRefresh);
  chrome.tabs.onAttached.addListener(scheduleLiveRefresh);
  chrome.tabs.onDetached.addListener(scheduleLiveRefresh);
  // Keep the audio indicators (and the audio filter) in sync as tabs start/stop
  // playing sound or get muted. Other property changes are ignored, as before.
  chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
    if (changeInfo.audible !== undefined || changeInfo.mutedInfo !== undefined) {
      scheduleLiveRefresh();
    }
  });
}

// Debounced so closing several tabs at once only triggers one rebuild.
function scheduleLiveRefresh() {
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(refreshLists, 150);
}

async function refreshLists() {
  // Don't rebuild the list out from under an open right-click menu.
  if (!document.getElementById('context-menu').hidden) {
    scheduleLiveRefresh();
    return;
  }
  const expanded = getExpandedDomains();
  const selected = getSelectedTabIds();
  await loadDomains();
  restoreExpandedDomains(expanded);
  restoreSelectedTabIds(selected);
  if (isPopout) await refreshWindowControls();
  if (document.getElementById('panel-groups').classList.contains('active')) {
    loadGroups();
  }
}

// ── Select-all / expand-collapse ──────────────────────────────────────────

function bindSelectAll() {
  document.getElementById('select-all').addEventListener('change', e => {
    document.querySelectorAll('#domain-list .tab-cb').forEach(cb => {
      cb.checked = e.target.checked;
    });
    document.querySelectorAll('#domain-list .domain-group').forEach(grp => {
      syncDomainCheckbox(grp.querySelector('.domain-cb'), grp.querySelector('.tab-rows'));
    });
    updateTabCount();
  });
}

function syncSelectAll() {
  const tabCbs   = [...document.querySelectorAll('#domain-list .tab-cb')];
  const nChecked = tabCbs.filter(cb => cb.checked).length;
  const sa = document.getElementById('select-all');
  sa.checked       = tabCbs.length > 0 && nChecked === tabCbs.length;
  sa.indeterminate = nChecked > 0 && nChecked < tabCbs.length;
  updateTabCount();
}

// Footer under the list: total groupable tabs, or "selected/total" when any are
// checked. Called from every path that changes the list or the selection.
function updateTabCount() {
  const el = document.getElementById('tab-count');
  if (!el) return;
  const total    = document.querySelectorAll('#domain-list .tab-cb').length;
  const selected = document.querySelectorAll('#domain-list .tab-cb:checked').length;
  el.textContent = selected > 0
    ? `${selected}/${total} tabs`
    : `${total} tab${total !== 1 ? 's' : ''}`;
  updateActionBar();
}

function syncDomainCheckbox(domainCb, tabRows) {
  const cbs      = [...tabRows.querySelectorAll('.tab-cb')];
  const nChecked = cbs.filter(cb => cb.checked).length;
  domainCb.checked       = nChecked === cbs.length;
  domainCb.indeterminate = nChecked > 0 && nChecked < cbs.length;
}

let audioFilter = false;   // when on, show only tabs currently playing audio

// Group filter: every group (plus a "No group" bucket) is a checkbox, all on by
// default. We track only the *unchecked* group ids — the ones to hide — so a
// newly-appearing group shows by default. An empty set = nothing filtered.
// Ungrouped tabs are represented by the id '-1' (Chrome's TAB_GROUP_ID_NONE).
const groupFilterHidden = new Set();   // group id strings currently unchecked

// Domain-list sort order. Chrome exposes no tab-creation time, so the "recent"
// modes use tab.lastAccessed (the last time the tab was focused).
let sortMode = 'recent';   // 'recent' | 'old' | 'count' | 'alpha'

// Colors cycled through to tag each window with a pip in the all-windows view.
const WINDOW_PIP_COLORS = [
  '#1a73e8', '#d93025', '#137333', '#f9ab00', '#a142f4',
  '#d01884', '#007b83', '#e37400', '#5f6368',
];

function bindDomainSearch() {
  document.getElementById('domain-search').addEventListener('input', filterDomains);
}

// The sort button opens a small context menu; picking an option re-sorts (and,
// for the age modes, re-orders tabs within each domain) without dropping the
// user's expansion or selection state. A check marks the active option.
function bindDomainSort() {
  const btn  = document.getElementById('sort-btn');
  const menu = document.getElementById('sort-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (menu.hidden) openSortMenu();
    else             closeSortMenu();
  });

  menu.querySelectorAll('.sort-option').forEach(opt => {
    opt.addEventListener('click', async e => {
      e.stopPropagation();
      closeSortMenu();
      const mode = opt.dataset.sort;
      if (mode === sortMode) return;
      sortMode = mode;
      updateSortMenu();
      const expanded = getExpandedDomains();
      const selected = getSelectedTabIds();
      await loadDomains();
      restoreExpandedDomains(expanded);
      restoreSelectedTabIds(selected);
    });
  });

  // Any click outside the menu dismisses it.
  document.addEventListener('click', closeSortMenu);
  updateSortMenu();
}

function openSortMenu() {
  const btn  = document.getElementById('sort-btn');
  const menu = document.getElementById('sort-menu');
  closeFilterMenu();
  closeColorMenu();
  updateSortMenu();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  positionMenu(btn, menu);
}

// Right-align a floating menu under its button, flipping above / clamping to
// stay on screen. The menu must already be visible so it can be measured.
function positionMenu(btn, menu) {
  const r  = btn.getBoundingClientRect();
  const mr = menu.getBoundingClientRect();
  let left = r.right - mr.width;
  let top  = r.bottom + 4;
  if (left < 4) left = 4;
  if (top + mr.height > window.innerHeight) top = Math.max(4, r.top - mr.height - 4);
  menu.style.left = `${left}px`;
  menu.style.top  = `${top}px`;
}

function closeSortMenu() {
  const menu = document.getElementById('sort-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  document.getElementById('sort-btn')?.setAttribute('aria-expanded', 'false');
}

function updateSortMenu() {
  document.querySelectorAll('#sort-menu .sort-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.sort === sortMode);
  });
}

// Per-domain sort keys: tab count, plus the newest/oldest last-accessed times
// among its tabs (used by the 'recent' / 'old' modes).
function domainInfo(tabs) {
  let recent = 0, oldest = Infinity;
  for (const t of tabs) {
    const la = t.lastAccessed ?? 0;
    if (la > recent) recent = la;
    if (la < oldest) oldest = la;
  }
  return { length: tabs.length, recent, old: oldest === Infinity ? 0 : oldest };
}

function bindAudioFilter() {
  const btn = document.getElementById('audio-filter');
  btn.addEventListener('click', () => {
    audioFilter = !audioFilter;
    btn.classList.toggle('active', audioFilter);
    btn.setAttribute('aria-pressed', String(audioFilter));
    filterDomains();
  });
}

// ── Group filter ─────────────────────────────────────────────────────────

// The filter button opens a floating menu styled like the sort menu, but it
// stays open for multi-select — dismissed only by an outside click or a second
// click on the button. A check marks each group that's currently shown.
function bindGroupFilter() {
  const btn  = document.getElementById('group-filter-btn');
  const menu = document.getElementById('filter-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (menu.hidden) openFilterMenu();
    else             closeFilterMenu();
  });

  // Clicks inside the menu (toggling groups, Reset) must not bubble to the
  // document dismiss handler — the drawer stays open while multi-selecting.
  menu.addEventListener('click', e => e.stopPropagation());

  // Reset: re-check everything (show all groups).
  document.getElementById('group-filter-clear').addEventListener('click', () => {
    groupFilterHidden.clear();
    populateGroupFilter();
    updateGroupFilterBtn();
    filterDomains();
  });

  // Any click elsewhere closes it.
  document.addEventListener('click', closeFilterMenu);
}

async function openFilterMenu() {
  const btn  = document.getElementById('group-filter-btn');
  const menu = document.getElementById('filter-menu');
  closeSortMenu();
  closeColorMenu();
  await populateGroupFilter();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  positionMenu(btn, menu);
}

function closeFilterMenu() {
  const menu = document.getElementById('filter-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  document.getElementById('group-filter-btn')?.setAttribute('aria-expanded', 'false');
}

// A "No group" checkbox plus one per group across *all* windows (not just the
// current scope), all checked unless the user has unchecked them. Counts are the
// group's total tab count, matching the My Groups panel.
async function populateGroupFilter() {
  const listEl = document.getElementById('group-filter-list');

  let groups = [];
  let allTabs = [];
  try {
    [groups, allTabs] = await Promise.all([
      chrome.tabGroups.query({}),
      chrome.tabs.query({}),
    ]);
  } catch {
    listEl.innerHTML = '<p class="empty-msg">Could not read groups.</p>';
    return;
  }

  const counts = new Map();   // group id string → total tab count (all windows)
  for (const tab of allTabs) {
    const gid = String(tab.groupId);   // -1 when ungrouped
    counts.set(gid, (counts.get(gid) ?? 0) + 1);
  }

  // Drop unchecked ids whose group no longer exists.
  const validIds = new Set([...groups.map(g => String(g.id)), '-1']);
  for (const gid of [...groupFilterHidden]) {
    if (!validIds.has(gid)) groupFilterHidden.delete(gid);
  }

  listEl.innerHTML = '';
  // "No group" first, as the default bucket for ungrouped tabs.
  listEl.appendChild(buildGroupFilterItem('-1', 'No group', '#5f6368', counts.get('-1') ?? 0));
  // Every group from every window, most tabs first.
  const sorted = [...groups].sort((a, b) =>
    (counts.get(String(b.id)) ?? 0) - (counts.get(String(a.id)) ?? 0));
  for (const g of sorted) {
    const gid = String(g.id);
    listEl.appendChild(buildGroupFilterItem(
      gid, g.title || 'Unnamed Group', COLOR_HEX[g.color] ?? '#5f6368', counts.get(gid) ?? 0
    ));
  }
}

// A menu row (context-menu style): a checkmark shown when the group is included,
// its color dot, name and tab count. Clicking toggles it without closing the menu.
function buildGroupFilterItem(gid, name, color, count) {
  const btn = document.createElement('button');
  btn.className = 'ctx-item filter-option';
  btn.dataset.gid = gid;
  btn.classList.toggle('active', !groupFilterHidden.has(gid));
  btn.innerHTML = `
    ${icon('check', 'ctx-icon ctx-check')}
    <span class="color-dot" style="background:${color}"></span>
    <span class="group-filter-name">${escHtml(name)}</span>
    <span class="tab-badge">${count}</span>
  `;
  btn.addEventListener('click', () => {
    if (groupFilterHidden.has(gid)) groupFilterHidden.delete(gid);
    else                            groupFilterHidden.add(gid);
    btn.classList.toggle('active', !groupFilterHidden.has(gid));
    updateGroupFilterBtn();
    filterDomains();
  });
  return btn;
}

function updateGroupFilterBtn() {
  const btn = document.getElementById('group-filter-btn');
  if (!btn) return;
  const active = groupFilterHidden.size > 0;
  btn.classList.toggle('active', active);
  btn.setAttribute('aria-pressed', String(active));
}

// A tab is shown unless its group's checkbox has been unchecked.
function matchesGroupFilter(row) {
  return !groupFilterHidden.has(row.dataset.groupId);
}

function filterDomains() {
  const query = document.getElementById('domain-search').value.toLowerCase();
  const groupFilterActive = groupFilterHidden.size > 0;

  document.querySelectorAll('#domain-list .domain-group').forEach(grp => {
    const domainMatches = grp.dataset.domain.toLowerCase().includes(query);
    const tabRows       = [...grp.querySelectorAll('.tab-row')];

    // A row survives every active filter: it must match the text query (directly
    // or via its domain name), be audible when the audio filter is on, and pass
    // the include/exclude group filter when one is set.
    let anyVisible    = false;
    let anyTitleMatch = false;
    tabRows.forEach(row => {
      const titleMatch = !!query
        && (row.querySelector('.tab-title')?.textContent.toLowerCase().includes(query) ?? false);
      const textMatch  = !query || domainMatches || titleMatch;
      const audioMatch = !audioFilter || row.dataset.audible === '1';
      const groupMatch = !groupFilterActive || matchesGroupFilter(row);
      const visible    = textMatch && audioMatch && groupMatch;
      row.hidden = !visible;
      if (visible) anyVisible = true;
      if (titleMatch && audioMatch && groupMatch) anyTitleMatch = true;
    });

    grp.hidden = !anyVisible;

    // Expand on a tab-title match (as before) or whenever a row-level filter is
    // on, so the surviving tabs are visible; a pure domain-name match stays collapsed.
    if (anyVisible && (anyTitleMatch || audioFilter || groupFilterActive)) {
      grp.querySelector('.expand-btn').setAttribute('aria-expanded', 'true');
      grp.querySelector('.tab-rows').hidden = false;
    }
  });
}

function bindExpandCollapse() {
  document.getElementById('expand-all').addEventListener('click', () => {
    document.querySelectorAll('#domain-list .domain-group').forEach(grp => {
      grp.querySelector('.expand-btn').setAttribute('aria-expanded', 'true');
      grp.querySelector('.tab-rows').hidden = false;
    });
  });
  document.getElementById('collapse-all').addEventListener('click', () => {
    document.querySelectorAll('#domain-list .domain-group').forEach(grp => {
      grp.querySelector('.expand-btn').setAttribute('aria-expanded', 'false');
      grp.querySelector('.tab-rows').hidden = true;
    });
  });
}

// ── Domain list ────────────────────────────────────────────────────────────

async function loadDomains() {
  const list = document.getElementById('domain-list');
  list.innerHTML = '<p class="empty-msg">Loading...</p>';
  const sa = document.getElementById('select-all');
  sa.checked = false;
  sa.indeterminate = false;
  tabsCache.clear();

  let tabs;
  try {
    const queryInfo =
      scope === 'all'     ? {} :
      scope === 'current' ? { windowId: currentWindowId } :
                            { windowId: Number(scope) };
    tabs = await chrome.tabs.query(queryInfo);
  } catch {
    list.innerHTML = '<p class="empty-msg">Could not read tabs.</p>';
    updateTabCount();
    return;
  }

  const domainMap = new Map();
  for (const tab of tabs) {
    const realUrl = getRealUrl(tab.url);
    if (!realUrl) continue;
    try {
      const { hostname } = new URL(realUrl);
      if (!hostname) continue;
      tabsCache.set(tab.id, tab);
      if (!domainMap.has(hostname)) domainMap.set(hostname, []);
      domainMap.get(hostname).push(tab);
    } catch { /* malformed URL */ }
  }

  if (domainMap.size === 0) {
    list.innerHTML = '<p class="empty-msg">No groupable tabs found.</p>';
    updateTabCount();
    return;
  }

  let groupsById = new Map();
  try {
    const allGroups = await chrome.tabGroups.query({});
    groupsById = new Map(allGroups.map(g => [g.id, g]));
  } catch {}

  // In the all-windows view, tag each window with a distinct pip color + label
  // so you can see at a glance which window a tab lives in.
  let windowInfo = null;
  if (scope === 'all') {
    try {
      const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      if (wins.length > 1) {
        wins.sort((a, b) => a.id - b.id);
        windowInfo = new Map();
        wins.forEach((win, i) => {
          windowInfo.set(win.id, {
            color: WINDOW_PIP_COLORS[i % WINDOW_PIP_COLORS.length],
            label: windowLabel(win) + (win.id === currentWindowId ? ' (current)' : ''),
          });
        });
      }
    } catch {}
  }

  list.innerHTML = '';
  const sorted = [...domainMap.entries()]
    .map(([domain, tabs]) => [domain, domainInfo(tabs), tabs])
    .sort(compareDomains);
  for (const [domain, , domainTabs] of sorted) {
    list.appendChild(buildDomainGroup(domain, domainTabs, groupsById, windowInfo));
  }

  filterDomains();
  updateTabCount();
}

// Favorites always come first; within each tier the chosen sort mode decides the
// order: most-recently-focused, least-recently-focused, most tabs, or domain name.
// Used for both the initial build and in-place re-sorts (favorite toggle).
// `a[0]`/`b[0]` are the domain; `a[1]`/`b[1]` carry the { length, recent, old }
// keys from domainInfo().
function compareDomains(a, b) {
  if (getPinFavorites()) {
    const favs = getFavorites();
    const fa = favs.has(a[0]) ? 1 : 0;
    const fb = favs.has(b[0]) ? 1 : 0;
    if (fa !== fb) return fb - fa;
  }
  if (sortMode === 'old')   return a[1].old - b[1].old;
  if (sortMode === 'count') return b[1].length - a[1].length;
  if (sortMode === 'alpha') return a[0].localeCompare(b[0]);
  return b[1].recent - a[1].recent;   // 'recent' (default): latest first
}

// Activate a tab and bring its window forward. Focusing another window blurs the
// toolbar popup (closing it), which is the expected behaviour here.
async function focusTab(tab) {
  if (!tab) return;
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  }
}

function buildDomainGroup(domain, domainTabs, groupsById = new Map(), windowInfo = null) {
  const grp = document.createElement('div');
  grp.className = 'domain-group';
  grp.dataset.domain = domain;
  grp.dataset.tabCount = domainTabs.length;

  // Stash the age keys so resortDomainList() can re-order without the tab data.
  const info = domainInfo(domainTabs);
  grp.dataset.recent = String(info.recent);
  grp.dataset.old    = String(info.old);

  // Order tabs within the domain to match the sort (Chrome's index order for 'count').
  let tabs = domainTabs;
  if (sortMode === 'recent')     tabs = [...domainTabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  else if (sortMode === 'old')   tabs = [...domainTabs].sort((a, b) => (a.lastAccessed ?? 0) - (b.lastAccessed ?? 0));
  else if (sortMode === 'alpha') tabs = [...domainTabs].sort((a, b) => getDisplayTitle(a).localeCompare(getDisplayTitle(b)));

  const audioCount = domainTabs.filter(t => t.audible || t.mutedInfo?.muted).length;

  const row = document.createElement('div');
  row.className = 'domain-row';
  row.innerHTML = `
    <input type="checkbox" class="domain-cb">
    <div class="domain-expand-area">
      <button class="expand-btn" aria-expanded="false">${icon('chevron-right')}</button>
      <span class="domain-name">${escHtml(domain)}</span>
      ${audioCount ? `<svg class="icon domain-audio" title="${audioCount} tab${audioCount > 1 ? 's' : ''} with audio" aria-hidden="true"><use href="#i-volume-high"></use></svg>` : ''}
      <span class="tab-badge">${domainTabs.length}</span>
    </div>
    <button class="fav-btn" aria-pressed="false">${icon('star')}</button>
  `;

  const tabRows = document.createElement('div');
  tabRows.className = 'tab-rows';
  tabRows.hidden = true;

  for (const tab of tabs) {
    const title  = getDisplayTitle(tab);
    const grpObj = tab.groupId >= 0 ? groupsById.get(tab.groupId) : null;
    const tagHtml = grpObj
      ? `<span class="tab-group-tag" style="background:${COLOR_HEX[grpObj.color] ?? '#5f6368'}" title="${escHtml(grpObj.title || 'Group')}">${escHtml(grpObj.title || '●')}</span>`
      : '';
    const muted = !!tab.mutedInfo?.muted;
    // Keep the control visible while muted too — Chrome drops `audible` to false
    // on mute, and we still want the muted-speaker icon (and a way to unmute).
    const hasAudio = tab.audible || muted;
    const audioHtml = hasAudio
      ? `<button class="tab-audio${muted ? ' muted' : ''}" data-tab-id="${tab.id}" title="${muted ? 'Unmute tab' : 'Mute tab'}">${icon(muted ? 'volume-xmark' : 'volume-high')}</button>`
      : '';
    const win = windowInfo?.get(tab.windowId);
    const pipHtml = win
      ? `<span class="tab-window-pip" style="background:${win.color}" title="${escHtml(win.label)}"></span>`
      : '';
    const lbl = document.createElement('label');
    lbl.className = 'tab-row';
    lbl.dataset.audible = hasAudio ? '1' : '0';
    lbl.dataset.groupId = String(tab.groupId);   // -1 when ungrouped
    lbl.innerHTML = `
      <input type="checkbox" class="tab-cb" data-tab-id="${tab.id}">
      ${pipHtml}
      <span class="tab-title" title="${escHtml(title)}">${escHtml(title)}</span>
      ${audioHtml}
      ${tagHtml}
    `;
    lbl.addEventListener('contextmenu', e => showContextMenu(e, tab.id));
    // Double-click focuses the tab without selecting it — the two clicks of the
    // double-click toggle the checkbox, so reset it and re-sync afterwards.
    lbl.addEventListener('dblclick', async e => {
      if (e.target.closest('.tab-audio')) return;   // the mute button has its own action
      e.preventDefault();                            // avoid selecting the title text
      const cb = lbl.querySelector('.tab-cb');
      cb.checked = false;
      syncDomainCheckbox(row.querySelector('.domain-cb'), tabRows);
      syncSelectAll();
      await focusTab(tabsCache.get(tab.id) ?? tab);
    });
    lbl.querySelector('.tab-audio')?.addEventListener('click', async e => {
      e.preventDefault();   // don't toggle the row's checkbox
      e.stopPropagation();
      try {
        await chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted });
      } catch (err) {
        showStatus(`Error: ${err.message}`, 'error');
      }
    });
    tabRows.appendChild(lbl);
  }

  grp.appendChild(row);
  grp.appendChild(tabRows);

  const expandArea = row.querySelector('.domain-expand-area');
  const expandBtn  = row.querySelector('.expand-btn');
  expandArea.addEventListener('click', () => {
    const open = expandBtn.getAttribute('aria-expanded') === 'true';
    expandBtn.setAttribute('aria-expanded', String(!open));
    tabRows.hidden = open;
  });

  const domainCb = row.querySelector('.domain-cb');
  domainCb.addEventListener('click', e => e.stopPropagation());
  domainCb.addEventListener('change', () => {
    tabRows.querySelectorAll('.tab-cb').forEach(cb => { cb.checked = domainCb.checked; });
    domainCb.indeterminate = false;
    syncSelectAll();
  });

  tabRows.querySelectorAll('.tab-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      syncDomainCheckbox(domainCb, tabRows);
      syncSelectAll();
    });
  });

  const favBtn = row.querySelector('.fav-btn');
  favBtn.addEventListener('click', () => {
    toggleFavorite(domain);
    updateFavBtn(grp);
    resortDomainList();
  });
  updateFavBtn(grp);

  return grp;
}

// Reflect a group's stored favorite state on its star button.
function updateFavBtn(grp) {
  const fav = isFavorite(grp.dataset.domain);
  grp.classList.toggle('favorited', fav);
  const btn = grp.querySelector('.fav-btn');
  btn.setAttribute('aria-pressed', String(fav));
  btn.title = fav ? 'Remove from favorites' : 'Add to favorites';
  btn.querySelector('.icon use').setAttribute('href', fav ? '#i-star-solid' : '#i-star');
}

// Re-order the existing groups in place (favorites first, then the active sort
// mode) without rebuilding — preserves expansion and checkbox selections.
function resortDomainList() {
  const list = document.getElementById('domain-list');
  const groups = [...list.querySelectorAll('.domain-group')]
    .map(grp => [grp.dataset.domain, {
      length: Number(grp.dataset.tabCount) || 0,
      recent: Number(grp.dataset.recent) || 0,
      old:    Number(grp.dataset.old) || 0,
    }, grp])
    .sort(compareDomains);
  for (const [, , grp] of groups) list.appendChild(grp);
}

// ── Create group ───────────────────────────────────────────────────────────

// Group the given tabs (by id). By default every tab is pulled into a single
// window and grouped once; splitByWindow keeps one group per originating window.
async function createGroupFromSelection(ids, name, color, splitByWindow) {
  const matching = ids.map(id => tabsCache.get(id)).filter(Boolean);
  if (matching.length === 0) throw new Error('No matching tabs found.');

  if (splitByWindow) {
    const byWindow = new Map();
    for (const tab of matching) {
      if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
      byWindow.get(tab.windowId).push(tab.id);
    }
    for (const [windowId, tabIds] of byWindow) {
      await groupTabsInWindow(tabIds, windowId, name, color);
    }
  } else {
    const targetWindowId = currentWindowId ?? matching[0].windowId;
    const foreign = matching.filter(t => t.windowId !== targetWindowId);
    if (foreign.length > 0) {
      await chrome.tabs.move(foreign.map(t => t.id), { windowId: targetWindowId, index: -1 });
    }
    await groupTabsInWindow(matching.map(t => t.id), targetWindowId, name, color);
  }
}

async function groupTabsInWindow(tabIds, windowId, name, color) {
  const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  const update = { color };
  if (name) update.title = name;
  await chrome.tabGroups.update(groupId, update);
}

// ── Add selected tabs to an existing group ─────────────────────────────────

// Add the given tabs (by id) to an existing group, pulling any that live in a
// different window into the group's window first. Returns how many were added
// (0 when they were all already in the group). Shared by the panel button below
// and the right-click "Add to Group" menu.
async function moveTabsToExistingGroup(tabIds, groupId) {
  const group       = await chrome.tabGroups.get(groupId);
  const groupTabIds = new Set((await chrome.tabs.query({ groupId })).map(t => t.id));

  const matching = tabIds
    .map(id => tabsCache.get(id))
    .filter(tab => tab && !groupTabIds.has(tab.id));

  if (matching.length === 0) return 0;

  const foreign = matching.filter(t => t.windowId !== group.windowId);
  if (foreign.length > 0) {
    await chrome.tabs.move(foreign.map(t => t.id), { windowId: group.windowId, index: -1 });
  }

  await chrome.tabs.group({ tabIds: matching.map(t => t.id), groupId });
  return matching.length;
}

// ── Selection action bar ───────────────────────────────────────────────────
// Appears under the list once 2+ tabs are selected. A dropdown chooses what to
// do with them; the fields and the "+" confirm button adapt to the choice.

function selectedTabIds() {
  return [...document.querySelectorAll('#domain-list .tab-cb:checked')]
    .map(cb => parseInt(cb.dataset.tabId, 10));
}

function bindActionBar() {
  const select = document.getElementById('action-select');
  if (!select) return;

  select.addEventListener('change', async () => {
    if (select.value === 'add-existing') await populateExistingGroupSelect();
    syncActionFields();
  });
  document.getElementById('group-name').addEventListener('input', syncActionFields);
  document.getElementById('existing-group-select').addEventListener('change', syncActionFields);
  document.getElementById('action-confirm').addEventListener('click', runAction);
}

// Actions that make sense for a single tab; everything else needs 2+ selected.
const SINGLE_TAB_ACTIONS = new Set(['new-window', 'close']);

// Show the bar once anything is selected. With one tab only "Move to new window"
// and "Close tabs" are offered; with 2+ every action is available.
function updateActionBar() {
  const opts = document.getElementById('create-options');
  if (!opts) return;
  const count     = document.querySelectorAll('#domain-list .tab-cb:checked').length;
  const show      = count >= 1;
  const wasHidden = opts.hidden;
  opts.hidden = !show;
  if (!show) return;

  const select = document.getElementById('action-select');
  const multi  = count >= 2;
  let currentHidden = false;
  for (const opt of select.options) {
    const allowed = multi || SINGLE_TAB_ACTIONS.has(opt.value);
    opt.hidden = opt.disabled = !allowed;
    if (!allowed && opt.value === select.value) currentHidden = true;
  }
  if (currentHidden) {
    const firstAllowed = [...select.options].find(o => !o.disabled);
    if (firstAllowed) select.value = firstAllowed.value;
  }

  if (wasHidden && select.value === 'add-existing') populateExistingGroupSelect();
  syncActionFields();
}

// Reveal only the inputs the current action needs, and enable "+" when it's ready.
function syncActionFields() {
  const action     = document.getElementById('action-select').value;
  const nameEl     = document.getElementById('group-name');
  const colorEl    = document.getElementById('color-trigger');
  const existingEl = document.getElementById('existing-group-select');
  const hintEl     = document.getElementById('action-hint');
  const confirm    = document.getElementById('action-confirm');

  const isGroup    = action === 'group' || action === 'group-split';
  const isExisting = action === 'add-existing';
  const count      = document.querySelectorAll('#domain-list .tab-cb:checked').length;

  nameEl.hidden     = !isGroup;
  colorEl.hidden    = !isGroup;
  existingEl.hidden = !isExisting;
  hintEl.hidden     = isGroup || isExisting;

  if (!isGroup && !isExisting) {
    const verb = action === 'close' ? 'Close' : action === 'bookmark' ? 'Bookmark' : 'Move';
    const suffix = action === 'new-window' ? ' to a new window' : '';
    hintEl.textContent = `${verb} ${count} tab${count !== 1 ? 's' : ''}${suffix}`;
  }

  let enabled = true;
  if (isGroup)         enabled = nameEl.value.trim().length > 0;
  else if (isExisting) enabled = existingEl.value !== '';
  confirm.disabled = !enabled;
}

// Fill the existing-group dropdown (placeholder first), keeping any live pick.
async function populateExistingGroupSelect() {
  const sel  = document.getElementById('existing-group-select');
  const prev = sel.value;
  let groups = [];
  try { groups = await chrome.tabGroups.query({}); } catch {}
  sel.innerHTML = '<option value="">groups</option>';
  for (const g of groups) {
    const opt = document.createElement('option');
    opt.value = String(g.id);
    opt.textContent = g.title || 'Unnamed Group';
    sel.appendChild(opt);
  }
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

async function runAction() {
  const action = document.getElementById('action-select').value;
  const ids    = selectedTabIds();
  if (ids.length === 0) return;

  const confirm = document.getElementById('action-confirm');
  confirm.disabled = true;

  try {
    if (action === 'group' || action === 'group-split') {
      const name = document.getElementById('group-name').value.trim();
      if (!name) return;
      await createGroupFromSelection(ids, name, selectedColor, action === 'group-split');
      document.getElementById('group-name').value = '';
      showStatus('Group created!', 'success');
    } else if (action === 'add-existing') {
      const gid = parseInt(document.getElementById('existing-group-select').value, 10);
      if (!Number.isInteger(gid)) return;
      const n = await moveTabsToExistingGroup(ids, gid);
      showStatus(n > 0 ? `Added ${n} tab${n !== 1 ? 's' : ''}.` : 'Those tabs are already in that group.',
                 n > 0 ? 'success' : 'error');
    } else if (action === 'new-window') {
      const n = await moveTabsToNewWindow(ids);
      showStatus(`Moved ${n} tab${n !== 1 ? 's' : ''} to a new window.`, 'success');
    } else if (action === 'close') {
      await chrome.tabs.remove(ids);
      showStatus(`Closed ${ids.length} tab${ids.length !== 1 ? 's' : ''}.`, 'success');
    } else if (action === 'bookmark') {
      const tabObjs = ids.map(id => tabsCache.get(id)).filter(Boolean);
      const { folderName, count } = await bookmarkTabs(tabObjs, defaultBookmarkFolderName());
      showStatus(`Saved ${count} tab${count !== 1 ? 's' : ''} to "${folderName}".`, 'success');
    }

    const expanded = getExpandedDomains();
    await loadDomains();               // clears the selection → hides the bar
    restoreExpandedDomains(expanded);
    if (isPopout) await refreshWindowControls();
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
    syncActionFields();
  }
}
