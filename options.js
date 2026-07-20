'use strict';

// Settings persist in localStorage, shared with the popup (same extension
// origin). Each control saves immediately on change.

document.addEventListener('DOMContentLoaded', () => {
  const themeSel = document.getElementById('opt-theme');
  const scopeSel = document.getElementById('opt-scope');
  const pinFav   = document.getElementById('opt-pin-fav');
  const toast    = document.getElementById('saved-toast');

  // Load current values.
  const theme = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  themeSel.value = theme;
  scopeSel.value = localStorage.getItem('defaultScope') === 'all' ? 'all' : 'current';
  pinFav.checked = localStorage.getItem('pinFavorites') !== 'false';

  let toastTimer = null;
  function flashSaved() {
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1200);
  }

  themeSel.addEventListener('change', () => {
    localStorage.setItem('theme', themeSel.value);
    document.documentElement.dataset.theme = themeSel.value;
    flashSaved();
  });

  scopeSel.addEventListener('change', () => {
    localStorage.setItem('defaultScope', scopeSel.value);
    flashSaved();
  });

  pinFav.addEventListener('change', () => {
    localStorage.setItem('pinFavorites', String(pinFav.checked));
    flashSaved();
  });
});
