'use strict';

function bindContextMenu() {
  document.addEventListener('click', () => {
    const menu = document.getElementById('context-menu');
    menu.hidden = true;
    resetContextMenu();
  });

  document.getElementById('ctx-focus').addEventListener('click', async () => {
    const tab = ctxTabId !== null ? tabsCache.get(ctxTabId) : null;
    ctxTabId = null;
    await focusTab(tab);
  });

  document.getElementById('ctx-pause').addEventListener('click', async () => {
    const id = ctxTabId;
    ctxTabId = null;
    if (id === null) return;
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (!tab) return;
    const expanded = getExpandedDomains();
    if (isSuspendedUrl(tab.url)) await resumeTab(tab);
    else                        await pauseTab(tab);
    await loadDomains();
    restoreExpandedDomains(expanded);
  });

  document.getElementById('ctx-pause-selected').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('#domain-list .tab-cb:checked')]
      .map(cb => parseInt(cb.dataset.tabId, 10));
    ctxTabId = null;
    if (ids.length === 0) return;
    const expanded = getExpandedDomains();
    await pauseTabIds(ids);
    await loadDomains();
    restoreExpandedDomains(expanded);
  });

  document.getElementById('ctx-resume-selected').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('#domain-list .tab-cb:checked')]
      .map(cb => parseInt(cb.dataset.tabId, 10));
    ctxTabId = null;
    if (ids.length === 0) return;
    const expanded = getExpandedDomains();
    await resumeTabIds(ids);
    await loadDomains();
    restoreExpandedDomains(expanded);
  });

  document.getElementById('ctx-add-to-group').addEventListener('click', async e => {
    e.stopPropagation();
    await showGroupPicker();
  });

  document.getElementById('ctx-back').addEventListener('click', e => {
    e.stopPropagation();
    resetContextMenu();
  });

  document.getElementById('ctx-close').addEventListener('click', async () => {
    const id = ctxTabId;
    ctxTabId = null;
    if (id === null) return;
    const expanded = getExpandedDomains();
    await chrome.tabs.remove(id);
    await loadDomains();
    restoreExpandedDomains(expanded);
  });

  document.getElementById('ctx-close-selected').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('#domain-list .tab-cb:checked')]
      .map(cb => parseInt(cb.dataset.tabId, 10));
    ctxTabId = null;
    if (ids.length === 0) return;
    const expanded = getExpandedDomains();
    await chrome.tabs.remove(ids);
    await loadDomains();
    restoreExpandedDomains(expanded);
  });

  document.getElementById('ctx-move-window').addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('#domain-list .tab-cb:checked')]
      .map(cb => parseInt(cb.dataset.tabId, 10));
    const ids = checked.length > 0 ? checked : (ctxTabId !== null ? [ctxTabId] : []);
    ctxTabId = null;
    if (ids.length === 0) return;
    const expanded = getExpandedDomains();
    try {
      const n = await moveTabsToNewWindow(ids);
      showStatus(`Moved ${n} tab${n !== 1 ? 's' : ''} to a new window.`, 'success');
    } catch (err) {
      showStatus(`Error: ${err.message}`, 'error');
    }
    await loadDomains();
    restoreExpandedDomains(expanded);
    if (isPopout) await refreshWindowControls();
  });
}

function resetContextMenu() {
  document.getElementById('ctx-main').hidden = false;
  document.getElementById('ctx-group-picker').hidden = true;
  document.getElementById('ctx-group-list').innerHTML = '';
}

async function showGroupPicker() {
  const list = document.getElementById('ctx-group-list');
  list.innerHTML = '';
  document.getElementById('ctx-main').hidden = true;
  document.getElementById('ctx-group-picker').hidden = false;

  try {
    const groups = await chrome.tabGroups.query({});
    if (groups.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-msg';
      p.style.padding = '8px 14px';
      p.textContent = 'No groups yet.';
      list.appendChild(p);
      return;
    }
    for (const group of groups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      const btn = document.createElement('button');
      btn.className = 'ctx-group-list-item';
      btn.innerHTML = `
        <span class="color-dot" style="background:${COLOR_HEX[group.color] ?? '#5f6368'}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${escHtml(group.title || 'Unnamed Group')}</span>
        <span class="tab-badge">${tabs.length}</span>
      `;
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        document.getElementById('context-menu').hidden = true;
        resetContextMenu();
        await addTabsViaContextMenu(group.id);
      });
      list.appendChild(btn);
    }
  } catch {}
}

async function addTabsViaContextMenu(groupId) {
  const checked = [...document.querySelectorAll('#domain-list .tab-cb:checked')]
    .map(cb => parseInt(cb.dataset.tabId, 10));
  const tabIds = checked.length > 0 ? checked : (ctxTabId !== null ? [ctxTabId] : []);
  ctxTabId = null;
  if (tabIds.length === 0) return;

  try {
    const n = await moveTabsToExistingGroup(tabIds, groupId);
    if (n === 0) {
      showStatus('Those tabs are already in that group.', 'error');
      return;
    }
    showStatus(`Added ${n} tab${n !== 1 ? 's' : ''}.`, 'success');
    const expanded = getExpandedDomains();
    await loadDomains();
    restoreExpandedDomains(expanded);
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  }
}

function showContextMenu(e, tabId) {
  e.preventDefault();
  e.stopPropagation();
  ctxTabId = tabId;
  resetContextMenu();

  const menu        = document.getElementById('context-menu');
  const closeSelBtn = document.getElementById('ctx-close-selected');
  const nSelected   = document.querySelectorAll('#domain-list .tab-cb:checked').length;

  // Single-tab pause/resume reflects the right-clicked tab's current state.
  const tab      = tabsCache.get(tabId);
  const pauseBtn = document.getElementById('ctx-pause');
  pauseBtn.innerHTML = tab && isSuspendedUrl(tab.url)
    ? `${icon('play', 'ctx-icon')} Resume tab`
    : `${icon('pause', 'ctx-icon')} Pause tab`;

  // Pause/resume for a multi-selection — show only the actions that apply.
  const pauseSelBtn  = document.getElementById('ctx-pause-selected');
  const resumeSelBtn = document.getElementById('ctx-resume-selected');
  if (nSelected >= 2) {
    const selTabs   = [...document.querySelectorAll('#domain-list .tab-cb:checked')]
      .map(cb => tabsCache.get(parseInt(cb.dataset.tabId, 10))).filter(Boolean);
    const pausedN   = selTabs.filter(t => isSuspendedUrl(t.url)).length;
    const unpausedN = selTabs.length - pausedN;

    pauseSelBtn.hidden = unpausedN === 0;
    if (unpausedN > 0) pauseSelBtn.innerHTML  = `${icon('pause', 'ctx-icon')} Pause ${unpausedN} selected`;
    resumeSelBtn.hidden = pausedN === 0;
    if (pausedN > 0)   resumeSelBtn.innerHTML = `${icon('play', 'ctx-icon')} Resume ${pausedN} selected`;
  } else {
    pauseSelBtn.hidden  = true;
    resumeSelBtn.hidden = true;
  }

  if (nSelected >= 2) {
    closeSelBtn.innerHTML = `${icon('xmark', 'ctx-icon')} Close ${nSelected} selected tabs`;
    closeSelBtn.hidden = false;
  } else {
    closeSelBtn.hidden = true;
  }

  // "Move to new window" acts on the selection when there is one, else this tab.
  document.getElementById('ctx-move-window').innerHTML = nSelected >= 2
    ? `${icon('arrow-right-from-bracket', 'ctx-icon')} Move ${nSelected} to new window`
    : `${icon('arrow-right-from-bracket', 'ctx-icon')} Move tab to new window`;

  menu.style.left = `${e.clientX}px`;
  menu.style.top  = `${e.clientY}px`;
  menu.hidden = false;

  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right  > window.innerWidth)  menu.style.left = `${e.clientX - r.width}px`;
    if (r.bottom > window.innerHeight) menu.style.top  = `${e.clientY - r.height}px`;
  });
}
