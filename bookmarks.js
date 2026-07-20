'use strict';

function defaultBookmarkFolderName() {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function getOrCreateTabManagerFolder() {
  const results  = await chrome.bookmarks.search({ title: 'Tab Manager' });
  const existing = results.find(b => !b.url);
  if (existing) return existing;
  return chrome.bookmarks.create({ title: 'Tab Manager' });
}

// Save the given tab objects into a new subfolder under "Tab Manager".
// Returns the folder name used and the number of tabs saved.
async function bookmarkTabs(tabObjs, folderName) {
  const root      = await getOrCreateTabManagerFolder();
  const subfolder = await chrome.bookmarks.create({ parentId: root.id, title: folderName });
  for (const tab of tabObjs) {
    await chrome.bookmarks.create({
      parentId: subfolder.id,
      title: getDisplayTitle(tab) || getRealUrl(tab.url) || tab.url,
      url:   getRealUrl(tab.url) ?? tab.url,
    });
  }
  return { folderName, count: tabObjs.length };
}
