'use strict';

/**
 * Injected as the `preload` for every <webview> tab (see main.js
 * `will-attach-webview`). contextIsolation is off for this script *only* so
 * it can patch the page's real `window`/`navigator` objects directly, before
 * any page script runs - Electron guarantees preload scripts execute first.
 *
 * This is best-effort, JS-level fingerprint resistance. It raises the bar for
 * casual/commercial trackers but is not equivalent to Tor Browser's years of
 * hardening at the engine level - see docs/THREAT_MODEL.md.
 */
(function privacyHardening() {
  const safeDefine = (obj, prop, getter) => {
    try {
      Object.defineProperty(obj, prop, { get: getter, configurable: true });
    } catch (err) {
      // Some properties may already be non-configurable in this Chromium
      // build; skip rather than throw and break the page.
    }
  };

  // --- Block camera for any getUserMedia call ("no video calls") ---
  // Microphone-only requests (voice notes, dictation) still work; only
  // video/camera constraints are refused. This mirrors the main-process
  // permission handler in main.js so the policy holds even if a page tries
  // to call the API before a permission prompt would fire.
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function patchedGetUserMedia(constraints) {
      if (constraints && constraints.video) {
        return Promise.reject(
          new DOMException('Camera access is disabled in Dago: video calls are not permitted.', 'NotAllowedError')
        );
      }
      return originalGetUserMedia(constraints);
    };
  }

  // --- Per-session noise seed (stable for the life of this tab/circuit) ---
  const seed = Math.floor(Math.random() * 2 ** 31);
  function noiseFor(x, y, channel) {
    // Small xorshift-derived offset in [-2, 2], deterministic per pixel so
    // repeated reads of the same canvas within a session stay consistent
    // (avoiding a fingerprinting signal of its own) while differing per tab.
    let h = (seed ^ (x * 374761393) ^ (y * 668265263) ^ (channel * 2246822519)) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = (h ^ (h >>> 16)) >>> 0;
    return (h % 5) - 2;
  }

  // --- Canvas fingerprint resistance ---
  try {
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function patchedGetImageData(...args) {
      const imageData = origGetImageData.apply(this, args);
      const [sx, sy] = args;
      for (let i = 0; i < imageData.data.length; i += 4) {
        const pixelIndex = i / 4;
        const x = sx + (pixelIndex % imageData.width);
        const y = sy + Math.floor(pixelIndex / imageData.width);
        imageData.data[i] = Math.min(255, Math.max(0, imageData.data[i] + noiseFor(x, y, 0)));
        imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + noiseFor(x, y, 1)));
        imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + noiseFor(x, y, 2)));
      }
      return imageData;
    };
  } catch (err) { /* non-fatal */ }

  // --- WebGL fingerprint resistance: normalize vendor/renderer strings ---
  try {
    const patchGl = (proto) => {
      const origGetParameter = proto.getParameter;
      proto.getParameter = function patchedGetParameter(param) {
        // UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL
        if (param === 37445) return 'Generic Vendor';
        if (param === 37446) return 'Generic Renderer';
        return origGetParameter.call(this, param);
      };
    };
    if (window.WebGLRenderingContext) patchGl(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) patchGl(WebGL2RenderingContext.prototype);
  } catch (err) { /* non-fatal */ }

  // --- Timezone normalization (report UTC, like Tor Browser) ---
  try {
    const origGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function patchedGetTimezoneOffset() {
      return 0;
    };
    const origResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function patchedResolvedOptions(...args) {
      const options = origResolvedOptions.apply(this, args);
      options.timeZone = 'UTC';
      return options;
    };
  } catch (err) { /* non-fatal */ }

  // --- Hardware/entropy reduction ---
  safeDefine(Navigator.prototype, 'hardwareConcurrency', () => 4);
  safeDefine(Navigator.prototype, 'deviceMemory', () => 8);

  // --- Screen size rounding (coarse "letterboxing"-style bucketing) ---
  const bucket = (value, step) => Math.floor(value / step) * step;
  try {
    const widthDesc = Object.getOwnPropertyDescriptor(Screen.prototype, 'width');
    const heightDesc = Object.getOwnPropertyDescriptor(Screen.prototype, 'height');
    const origWidth = widthDesc.get.call(window.screen);
    const origHeight = heightDesc.get.call(window.screen);
    safeDefine(Screen.prototype, 'width', () => bucket(origWidth, 100));
    safeDefine(Screen.prototype, 'height', () => bucket(origHeight, 100));
  } catch (err) { /* non-fatal */ }
})();
