'use strict';

// Runs first in every Dago UI page (main chrome, utility windows, new-tab
// page): applies the theme the main process stamped into this page's URL
// (?dago-theme=light|dark) BEFORE first paint - this script is
// parser-blocking, so there is no flash of the wrong theme - then tracks
// live changes over the preload bridge where one exists (the new-tab page
// runs inside a webview with no bridge, so it only ever uses the stamp;
// renderer.js re-stamps it when the theme changes).
//
// `data-theme="light"` on <html> selects the light variable set; dark is
// the default (no attribute), matching the app's original look, so dark
// users and first paint never depend on this script running at all.
(function initTheme() {
  const apply = (resolved) => {
    if (resolved === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
  };

  try {
    const stamped = new URLSearchParams(window.location.search).get('dago-theme');
    if (stamped === 'light' || stamped === 'dark') apply(stamped);
  } catch (err) {
    // fall through to the bridge lookup below
  }

  const bridge = window.dago && window.dago.theme;
  if (bridge) {
    bridge.get().then(({ resolved }) => apply(resolved)).catch(() => {});
    bridge.onChanged(({ resolved }) => apply(resolved));
  }
})();
