'use strict';

// ── Merge color picker ─────────────────────────────────────────────────────

function bindMergeColorPicker() {
  document.querySelectorAll('#merge-color-picker .swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#merge-color-picker .swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      selectedMergeColor = sw.dataset.mergeColor;
    });
  });
}

function updateMergeBar() {
  const count = document.querySelectorAll('.group-select-cb:checked').length;
  document.getElementById('merge-bar').hidden = count < 2;
}

// ── Merge groups ───────────────────────────────────────────────────────────

async function mergeSelectedGroups() {
  const checkedBoxes = [...document.querySelectorAll('.group-select-cb:checked')];
  if (checkedBoxes.length < 2) return;

  const groupIds = checkedBoxes.map(cb => parseInt(cb.dataset.gid, 10));

  const btn = document.getElementById('merge-btn');
  btn.disabled = true;
  btn.textContent = 'Merging…';

  try {
    const allTabs = [];
    for (const gid of groupIds) {
      const tabs = await chrome.tabs.query({ groupId: gid });
      allTabs.push(...tabs);
    }

    if (allTabs.length === 0) { await loadGroups(); return; }

    let name = document.getElementById('merge-name').value.trim();
    if (!name) {
      try {
        const firstGroup = await chrome.tabGroups.get(groupIds[0]);
        name = firstGroup.title || '';
      } catch {}
    }

    await chrome.tabs.ungroup(allTabs.map(t => t.id));

    const foreign = allTabs.filter(t => t.windowId !== currentWindowId);
    if (foreign.length > 0) {
      await chrome.tabs.move(foreign.map(t => t.id), { windowId: currentWindowId, index: -1 });
    }

    const newGroupId = await chrome.tabs.group({
      tabIds: allTabs.map(t => t.id),
      createProperties: { windowId: currentWindowId },
    });

    const update = { color: selectedMergeColor };
    if (name) update.title = name;
    await chrome.tabGroups.update(newGroupId, update);

    document.getElementById('merge-name').value = '';
    await loadGroups();

  } catch (err) {
    console.error('Merge error:', err);
    await loadGroups();
  } finally {
    btn.disabled = false;
    btn.textContent = isPopout ? 'Merge to last-active window' : 'Merge to current window';
  }
}

// ── Group search ───────────────────────────────────────────────────────────

function bindGroupSearch() {
  document.getElementById('group-search').addEventListener('input', filterGroups);
}

function filterGroups() {
  const query = document.getElementById('group-search').value.toLowerCase().trim();

  document.querySelectorAll('#groups-list .group-wrapper').forEach(wrapper => {
    if (!query) {
      wrapper.hidden = false;
      wrapper.querySelectorAll('.group-tab-row').forEach(row => { row.hidden = false; });
      return;
    }

    const groupName     = wrapper.querySelector('.group-title')?.textContent.toLowerCase() ?? '';
    const groupMatches  = groupName.includes(query);
    const tabRows       = [...wrapper.querySelectorAll('.group-tab-row')];

    let anyTabMatch = false;
    tabRows.forEach(row => {
      const matches = row.dataset.title?.includes(query) || row.dataset.domain?.includes(query);
      row.hidden = !matches;
      if (matches) anyTabMatch = true;
    });

    if (!groupMatches && !anyTabMatch) {
      wrapper.hidden = true;
    } else if (groupMatches && !anyTabMatch) {
      wrapper.hidden = false;
      tabRows.forEach(row => { row.hidden = false; });
    } else {
      wrapper.hidden = false;
      wrapper.querySelector('.group-expand-btn').setAttribute('aria-expanded', 'true');
      wrapper.querySelector('.group-tabs').hidden = false;
    }
  });
}

// ── Groups panel ───────────────────────────────────────────────────────────

async function loadGroups() {
  const list = document.getElementById('groups-list');
  list.innerHTML = '<p class="empty-msg">Loading…</p>';
  document.getElementById('merge-bar').hidden = true;

  try {
    const groups = await chrome.tabGroups.query({});

    if (groups.length === 0) {
      list.innerHTML = '<p class="empty-msg">No tab groups yet.</p>';
      return;
    }

    list.innerHTML = '';
    const suspBase = chrome.runtime.getURL('suspended.html');

    for (const group of groups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      const suspCount = tabs.filter(t => {
        if (!t.url) return false;
        if (t.url.startsWith(suspBase)) return true;
        try {
          const p = new URL(t.url);
          return p.protocol === 'chrome-extension:' && p.searchParams.has('url');
        } catch { return false; }
      }).length;
      const allPaused  = suspCount > 0 && suspCount === tabs.length;
      const somePaused = suspCount > 0 && !allPaused;

      let meta = `${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`;
      if (allPaused) meta += ' · paused';
      else if (somePaused) meta += ` · ${suspCount} paused`;

      const wrapper = document.createElement('div');
      wrapper.className = 'group-wrapper';
      wrapper.innerHTML = `
        <div class="group-card">
          <input type="checkbox" class="group-select-cb" data-gid="${group.id}">
          <div class="group-expand-area">
            <button class="group-expand-btn" aria-expanded="false">${icon('chevron-right')}</button>
            <div class="color-dot" style="background:${COLOR_HEX[group.color] ?? '#5f6368'}"></div>
            <div class="group-info">
              <span class="group-title">${escHtml(group.title || 'Unnamed Group')}</span>
              <span class="group-meta">${meta}</span>
            </div>
          </div>
          <div class="group-actions">
            <button class="btn-icon group-menu-btn" title="Group actions">${icon('chevron-down')}</button>
          </div>
        </div>
        <div class="group-tabs" hidden></div>
        <div class="add-panel" hidden>
          <p class="add-panel-label">Add tabs from domain</p>
          <div class="add-domain-list">
            <p class="empty-msg">Loading…</p>
          </div>
          <div class="add-panel-footer">
            <button class="btn-sm btn-add-confirm">Add to Group</button>
            <button class="btn-sm btn-add-cancel">Cancel</button>
          </div>
        </div>
      `;

      const gid      = group.id;
      const windowId = group.windowId;

      wrapper.querySelector('.group-select-cb').addEventListener('change', updateMergeBar);

      // Pre-populate tab rows (tabs already fetched above for paused counting)
      const groupTabsEl = wrapper.querySelector('.group-tabs');
      for (const tab of tabs) {
        const title   = getDisplayTitle(tab);
        const realUrl = getRealUrl(tab.url);
        let domain = '';
        try { domain = realUrl ? new URL(realUrl).hostname : ''; } catch {}
        const fav = tab.favIconUrl ? escHtml(tab.favIconUrl) : '';
        const row = document.createElement('div');
        row.className = 'group-tab-row';
        row.dataset.title  = title.toLowerCase();
        row.dataset.domain = domain.toLowerCase();
        row.innerHTML = `
          <div class="group-tab-fav">${fav
            ? `<img src="${fav}" width="14" height="14">`
            : icon('globe')}</div>
          <div class="group-tab-info">
            <span class="group-tab-title" title="${escHtml(title)}">${escHtml(title)}</span>
            ${domain ? `<span class="group-tab-domain">${escHtml(domain)}</span>` : ''}
          </div>
        `;
        // Hide a broken favicon (CSP forbids an inline onerror handler).
        row.querySelector('.group-tab-fav img')
          ?.addEventListener('error', e => { e.target.style.display = 'none'; });
        row.addEventListener('click', async () => {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
        });
        groupTabsEl.appendChild(row);
      }

      // Expand/collapse — simple toggle, rows already rendered
      const expandArea = wrapper.querySelector('.group-expand-area');
      const expandBtn  = wrapper.querySelector('.group-expand-btn');

      expandArea.addEventListener('click', () => {
        const isOpen = expandBtn.getAttribute('aria-expanded') === 'true';
        expandBtn.setAttribute('aria-expanded', String(!isOpen));
        groupTabsEl.hidden = isOpen;
      });

      // Inline rename — stop propagation so expand doesn't also fire
      const titleSpan = wrapper.querySelector('.group-title');
      titleSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'group-rename-input';
        inp.value = group.title || '';
        inp.placeholder = 'Group name…';
        titleSpan.replaceWith(inp);
        inp.focus();
        inp.select();

        async function commitRename() {
          try { await chrome.tabGroups.update(gid, { title: inp.value.trim() }); } catch {}
          await loadGroups();
        }

        inp.addEventListener('blur', commitRename);
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
          if (e.key === 'Escape') { inp.removeEventListener('blur', commitRename); loadGroups(); }
        });
      });

      // The dropdown arrow opens a shared actions menu, bound to this group.
      const menuBtn = wrapper.querySelector('.group-menu-btn');
      menuBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (!document.getElementById('group-menu').hidden && groupMenuAnchor === menuBtn) {
          closeGroupMenu();
          return;
        }
        openGroupMenu(menuBtn, {
          close: async () => {
            try { await chrome.tabs.remove(tabs.map(t => t.id)); }
            catch (err) { showStatus(`Error: ${err.message}`, 'error'); }
            await loadGroups();
          },
          bookmark: async () => {
            try {
              const { folderName, count } =
                await bookmarkTabs(tabs, group.title?.trim() || defaultBookmarkFolderName());
              showStatus(`Saved ${count} tab${count !== 1 ? 's' : ''} to "${folderName}".`, 'success');
            } catch (err) { showStatus(`Bookmark error: ${err.message}`, 'error'); }
          },
          add: async () => {
            wrapper.querySelector('.add-panel').hidden = false;
            await populateAddPanel(gid, windowId, wrapper);
          },
          pause: async () => {
            try { if (allPaused) await resumeGroup(gid); else await pauseGroup(gid); }
            catch (err) { console.error(err); }
            await loadGroups();
          },
          ungroup: async () => {
            try { await resumeGroup(gid); await chrome.tabs.ungroup(tabs.map(t => t.id)); }
            catch (err) { console.error(err); }
            await loadGroups();
          },
        }, allPaused ? 'Resume' : 'Pause');
      });

      wrapper.querySelector('.btn-add-confirm').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const checked = new Set(
          [...wrapper.querySelectorAll('.add-domain-list input:checked')].map(cb => cb.value)
        );
        if (checked.size === 0) return;
        btn.disabled = true;
        btn.textContent = 'Adding…';
        try {
          await addToGroup(gid, windowId, checked);
        } catch (err) { console.error(err); }
        await loadGroups();
      });

      wrapper.querySelector('.btn-add-cancel').addEventListener('click', () => {
        wrapper.querySelector('.add-panel').hidden = true;
      });

      list.appendChild(wrapper);
    }

    filterGroups();

  } catch (err) {
    list.innerHTML = `<p class="empty-msg">Error: ${escHtml(err.message)}</p>`;
  }
}

// ── Per-group actions menu ─────────────────────────────────────────────────
// One shared floating menu, re-pointed at whichever group's arrow was clicked.
// The card supplies the action callbacks (it holds the group's tabs/state).

let groupMenuActions = null;
let groupMenuAnchor  = null;

function bindGroupMenu() {
  const menu = document.getElementById('group-menu');
  if (!menu) return;
  menu.addEventListener('click', e => e.stopPropagation());
  const run = key => () => { const fn = groupMenuActions?.[key]; closeGroupMenu(); fn?.(); };
  menu.querySelector('.gm-close').addEventListener('click', run('close'));
  menu.querySelector('.gm-bookmark').addEventListener('click', run('bookmark'));
  menu.querySelector('.gm-add').addEventListener('click', run('add'));
  menu.querySelector('.gm-pause').addEventListener('click', run('pause'));
  menu.querySelector('.gm-ungroup').addEventListener('click', run('ungroup'));
  document.addEventListener('click', closeGroupMenu);
}

function openGroupMenu(anchor, actions, pauseLabel) {
  const menu = document.getElementById('group-menu');
  groupMenuActions = actions;
  groupMenuAnchor  = anchor;
  const pauseItem = menu.querySelector('.gm-pause');
  pauseItem.querySelector('.gm-label').textContent = pauseLabel;
  pauseItem.querySelector('.icon use').setAttribute('href', pauseLabel === 'Resume' ? '#i-play' : '#i-pause');
  menu.hidden = false;
  positionMenu(anchor, menu);
}

function closeGroupMenu() {
  const menu = document.getElementById('group-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  groupMenuActions = null;
  groupMenuAnchor  = null;
}

async function populateAddPanel(groupId, windowId, wrapper) {
  const domainListEl = wrapper.querySelector('.add-domain-list');
  domainListEl.innerHTML = '<p class="empty-msg">Loading…</p>';

  const groupTabIds = new Set((await chrome.tabs.query({ groupId })).map(t => t.id));
  const allTabs     = await chrome.tabs.query({ windowId });

  const domainMap = new Map();
  for (const tab of allTabs) {
    if (groupTabIds.has(tab.id)) continue;
    const realUrl = getRealUrl(tab.url);
    if (!realUrl) continue;
    try {
      const { hostname } = new URL(realUrl);
      if (!hostname) continue;
      domainMap.set(hostname, (domainMap.get(hostname) ?? 0) + 1);
    } catch { /* malformed */ }
  }

  if (domainMap.size === 0) {
    domainListEl.innerHTML = '<p class="empty-msg">No other tabs available.</p>';
    return;
  }

  domainListEl.innerHTML = '';
  for (const [domain, count] of [...domainMap.entries()].sort((a, b) => b[1] - a[1])) {
    const label = document.createElement('label');
    label.className = 'domain-item';
    label.innerHTML = `
      <input type="checkbox" value="${escHtml(domain)}">
      <span class="domain-name">${escHtml(domain)}</span>
      <span class="tab-badge">${count}</span>
    `;
    domainListEl.appendChild(label);
  }
}

async function addToGroup(groupId, windowId, checkedDomains) {
  const groupTabIds = new Set((await chrome.tabs.query({ groupId })).map(t => t.id));
  const allTabs     = await chrome.tabs.query({ windowId });

  const toAdd = allTabs
    .filter(tab => {
      if (groupTabIds.has(tab.id)) return false;
      const realUrl = getRealUrl(tab.url);
      if (!realUrl) return false;
      try { return checkedDomains.has(new URL(realUrl).hostname); }
      catch { return false; }
    })
    .map(t => t.id);

  if (toAdd.length > 0) {
    await chrome.tabs.group({ tabIds: toAdd, groupId });
  }
}

// ── Pause / resume ─────────────────────────────────────────────────────────

function isSuspendedUrl(url) {
  return !!url && url.startsWith(chrome.runtime.getURL('suspended.html'));
}

// Replace a tab with the paused placeholder, preserving its URL, title and
// favicon in the query string so it survives (and stays recognizable) across
// browser restarts.
async function pauseTab(tab) {
  if (!tab || isSuspendedUrl(tab.url)) return false;
  const realUrl = getRealUrl(tab.url);
  if (!realUrl) return false;
  let dest = `${chrome.runtime.getURL('suspended.html')}?url=${encodeURIComponent(realUrl)}`
           + `&title=${encodeURIComponent(tab.title ?? '')}`;
  if (tab.favIconUrl) dest += `&fav=${encodeURIComponent(tab.favIconUrl)}`;
  await chrome.tabs.update(tab.id, { url: dest });
  return true;
}

async function resumeTab(tab) {
  if (!tab || !isSuspendedUrl(tab.url)) return false;
  try {
    const original = new URL(tab.url).searchParams.get('url');
    if (original) { await chrome.tabs.update(tab.id, { url: original }); return true; }
  } catch { /* malformed */ }
  return false;
}

async function pauseTabIds(ids) {
  let n = 0;
  for (const id of ids) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (await pauseTab(tab)) n++;
  }
  return n;
}

async function resumeTabIds(ids) {
  let n = 0;
  for (const id of ids) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (await resumeTab(tab)) n++;
  }
  return n;
}

async function pauseGroup(groupId) {
  const tabs = await chrome.tabs.query({ groupId });
  for (const tab of tabs) await pauseTab(tab);
}

async function resumeGroup(groupId) {
  const tabs = await chrome.tabs.query({ groupId });
  for (const tab of tabs) await resumeTab(tab);
}
