# better.tabs

A Chrome extension for those who have issues hoarding tabs like I do. Group tabs by domain, sort, search, and
filter them, pause groups to free up memory, and manage everything from a convienent extension.

Note: Co-Authored by Claude, tryna get used to an agentic workflow. It did pretty good I'd say...

## Features

- **Group by domain** — tabs are bucketed by site so you can see them at a glance.
- **Sort** — most recently used, least recently used, most tabs per domain, or alphabetical (always keeping your favorites pinned first).
- **Filter** — hide/show tabs by their group, filter to tabs playing audio, or search domains and titles.
- **Favorites** — star domains to keep them at the top of every view.
- **Selection actions** — with tabs selected, create a group (merge them all into one window or keep them separate), add them to an existing group, move them to a new window, close them, or bookmark them.
- **Groups view** — rename, add tabs, pause/resume, ungroup, close all, bookmark, or merge groups.
- **Pause tabs** — parks a tab on a lightweight placeholder page to reclaim memory, and restores it (with its title and favicon) on demand — surviving browser restarts.
- **Pop-out window** — a standalone, wider view with a resizable window sidebar.
- **Light / dark theme** and a **settings page** for your defaults.

## Settings

Open the gear icon in the popup (or the extension's options page) to set:

- **Theme** — light or dark.
- **Start on** — which scope the popup opens with (Current Window / All Windows).
- **Pin favorite domains** — keep starred domains at the top in every view.

## Permissions

| Permission | Why it's needed |
| --- | --- |
| `tabs` | Read tab titles/URLs to group them and act on them. |
| `tabGroups` | Create, rename, color, and manage Chrome tab groups. |
| `windows` | Move tabs between windows and open the pop-out. |
| `bookmarks` | Save selected tabs or groups to a "Tab Manager" bookmarks folder. |

The extension stores your preferences (theme, defaults, favorites) locally in
`localStorage` and does not collect or transmit any data. I don' wannit. 

## Project layout

```
manifest.json      Extension manifest (MV3)
popup.html         Toolbar popup + pop-out UI (and the inline icon sprite)
popup.css          Styles + theme variables
popup.js           Bootstrap, theme, nav, color picker
domains.js         Domain list, sorting/filtering, selection action bar
groups.js          My Groups view, merge, pause/resume
context-menu.js    Right-click actions for tab rows
bookmarks.js       Bookmark helpers
utils.js           Shared helpers (icons, settings, escaping)
suspended.html/js  The paused-tab placeholder page
options.html/css/js  Settings page
icons/             Extension icon
```

## Development notes

- No bundler or dependencies — edit the files and reload the unpacked extension.
- Icons are inline SVG (`<symbol>` sprite in `popup.html`, referenced via the `icon()` helper).

## Author

Created by Lane Wheeler — lanecwheeler@gmail.com
