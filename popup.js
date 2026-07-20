'use strict';

// ── Shared state ───────────────────────────────────────────────────────────

let scope              = 'current';  // 'current' / 'all', or a window id string (pop-out only)
let selectedColor      = 'blue';
let selectedMergeColor = 'blue';
let currentWindowId    = null;
let isPopout           = false;     // running in our own standalone window?
let tabsCache          = new Map(); // tabId → Tab
let ctxTabId           = null;      // tab targeted by the active right-click menu

// ── Bootstrap ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  isPopout = new URLSearchParams(location.search).get('popout') === '1';

  if (isPopout) {
    // Our own window has no normal tabs, so resolve "current window" (the merge
    // target) to the last-focused real browser window, and default to All Windows.
    const normal = await chrome.windows
      .getLastFocused({ windowTypes: ['normal'] })
      .catch(() => null);
    currentWindowId = normal?.id ?? null;
    scope = 'all';
  } else {
    const win = await chrome.windows.getCurrent();
    currentWindowId = win.id;
    scope = getDefaultScope();
  }

  initTheme();
  bindNav();
  await bindScope();
  bindColorPicker();
  bindSelectAll();
  bindExpandCollapse();
  bindDomainSearch();
  bindDomainSort();
  bindAudioFilter();
  bindGroupFilter();
  bindGroupSearch();
  bindContextMenu();
  bindPopout();
  bindPauseCurrent();
  bindLiveUpdates();
  bindActionBar();
  bindGroupMenu();
  bindSidebarResizer();
  document.getElementById('merge-btn').addEventListener('click', mergeSelectedGroups);
  bindMergeColorPicker();
  document.getElementById('settings-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());

  if (isPopout) applyPopoutMode();

  await loadDomains();
  loadGroups();
});

// ── Pop-out window ───────────────────────────────────────────────────────────

function bindPopout() {
  const btn = document.getElementById('popout-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    await chrome.windows.create({
      url: chrome.runtime.getURL('popup.html?popout=1'),
      type: 'popup',
      width: 720,
      height: 720,
    });
    window.close(); // dismiss the toolbar popup
  });
}

function applyPopoutMode() {
  document.body.classList.add('popout-mode');

  // No need to pop out again from within the pop-out window.
  document.getElementById('popout-btn')?.setAttribute('hidden', '');

  // Merge targets the last-active browser window, not "this" window.
  const mergeBtn = document.getElementById('merge-btn');
  if (mergeBtn) mergeBtn.textContent = 'Merge to last-active window';
}

// ── Pause / resume the current tab ───────────────────────────────────────────

function bindPauseCurrent() {
  const btn = document.getElementById('pause-current');
  if (!btn) return;
  btn.addEventListener('click', togglePauseCurrent);
  updatePauseCurrentBtn();
}

// The tab the user is actually looking at: the active tab of this window, or —
// when popped out — of whichever real browser window was last focused.
async function getActiveBrowserTab() {
  if (isPopout) {
    const win = await chrome.windows
      .getLastFocused({ windowTypes: ['normal'], populate: true })
      .catch(() => null);
    return win?.tabs?.find(t => t.active) ?? null;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId: currentWindowId });
  return tab ?? null;
}

async function togglePauseCurrent() {
  const tab = await getActiveBrowserTab();
  if (!tab) { showStatus('No active tab found.', 'error'); return; }
  if (isSuspendedUrl(tab.url)) await resumeTab(tab);
  else                        await pauseTab(tab);
  await updatePauseCurrentBtn();
  scheduleLiveRefresh();
}

async function updatePauseCurrentBtn() {
  const btn = document.getElementById('pause-current');
  if (!btn) return;
  const tab    = await getActiveBrowserTab();
  const paused = tab && isSuspendedUrl(tab.url);
  btn.innerHTML = paused ? icon('play') : icon('pause');
  btn.title     = paused ? 'Resume current tab' : 'Pause current tab';
}

// ── Nav ────────────────────────────────────────────────────────────────────

function bindNav() {
  document.getElementById('tab-create').addEventListener('click', () => switchPanel('create'));
  document.getElementById('tab-groups').addEventListener('click', () => switchPanel('groups'));
}

function switchPanel(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-${name}`));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  if (name === 'groups') loadGroups();
}

// ── Color picker ───────────────────────────────────────────────────────────
// The trigger shows the current color; clicking opens a 3×3 popup of color
// circles (same floating-menu pattern as sort/filter), with a check on the
// selected one. Picking a color closes the menu.

function bindColorPicker() {
  const trigger = document.getElementById('color-trigger');
  const menu    = document.getElementById('color-menu');
  if (!trigger || !menu) return;

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    if (menu.hidden) openColorMenu();
    else             closeColorMenu();
  });

  menu.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', e => {
      e.stopPropagation();
      selectedColor = sw.dataset.color;
      updateColorMenu();
      closeColorMenu();
    });
  });

  document.addEventListener('click', closeColorMenu);
  updateColorMenu();
}

function openColorMenu() {
  const trigger = document.getElementById('color-trigger');
  const menu    = document.getElementById('color-menu');
  closeSortMenu();
  closeFilterMenu();
  updateColorMenu();
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  positionMenu(trigger, menu);
}

function closeColorMenu() {
  const menu = document.getElementById('color-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  document.getElementById('color-trigger')?.setAttribute('aria-expanded', 'false');
}

// Check the active swatch and paint the trigger with the current color.
function updateColorMenu() {
  document.querySelectorAll('#color-menu .color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === selectedColor);
  });
  const dot = document.getElementById('color-trigger-dot');
  if (dot) dot.style.background = COLOR_HEX[selectedColor] ?? '#5f6368';
}

// ── Theme ──────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('theme') ?? 'light';
  document.documentElement.dataset.theme = saved;
  updateThemeIcon(saved);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  document.getElementById('theme-toggle').innerHTML =
    theme === 'dark' ? icon('sun') : icon('moon');
}
