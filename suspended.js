'use strict';

// Never navigate to a scheme that could run script from the query string
// (defense-in-depth; the page CSP already blocks javascript: navigations).
function isSafeResumeUrl(url) {
  try {
    const scheme = new URL(url).protocol.toLowerCase();
    return !['javascript:', 'data:', 'blob:', 'vbscript:'].includes(scheme);
  } catch {
    return false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const params      = new URLSearchParams(window.location.search);
  const originalUrl = params.get('url') ?? '';
  const title       = params.get('title') ?? originalUrl;
  const favicon     = params.get('fav');
  const canResume   = isSafeResumeUrl(originalUrl);

  if (favicon) {
    const link = document.createElement('link');
    link.rel  = 'icon';
    link.href = favicon;
    document.head.appendChild(link);
  }

  if (title) {
    document.title = `[Paused] ${title}`;
    document.getElementById('tab-title').textContent = title;
  }

  if (originalUrl) {
    document.getElementById('tab-url').textContent = originalUrl;
  }

  const resumeBtn = document.getElementById('resume-btn');
  resumeBtn.disabled = !canResume;
  resumeBtn.addEventListener('click', () => {
    if (canResume) window.location.href = originalUrl;
  });
});
