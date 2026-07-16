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

  // Generic deterministic hash -> noise in [-1, 1], scaled by the caller.
  // Same (index, channel, tag) always yields the same offset within a
  // session, so repeated reads of the same canvas/audio buffer stay
  // internally consistent (a fingerprinting signal of its own would appear
  // if noise changed between calls) while differing from tab to tab.
  function noiseUnit(index, channel, tag) {
    let h = (seed ^ (index * 374761393) ^ (channel * 668265263) ^ (tag * 2246822519)) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = (h ^ (h >>> 16)) >>> 0;
    return (h % 2001) / 1000 - 1; // [-1, 1]
  }
  const noiseByte = (index, channel) => Math.round(noiseUnit(index, channel, 1) * 2); // integer in [-2, 2]
  const noiseSample = (index, channel) => noiseUnit(index, channel, 2) * 0.0005; // for -1..1 range audio samples
  const noiseDb = (index, channel) => noiseUnit(index, channel, 3) * 0.75; // for dB-scale frequency data

  function addNoiseToImageData(imageData, sx, sy) {
    for (let i = 0; i < imageData.data.length; i += 4) {
      const pixelIndex = i / 4;
      const x = sx + (pixelIndex % imageData.width);
      const y = sy + Math.floor(pixelIndex / imageData.width);
      const idx = y * 100003 + x; // fold 2D position into one index for noiseByte
      imageData.data[i] = Math.min(255, Math.max(0, imageData.data[i] + noiseByte(idx, 0)));
      imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + noiseByte(idx, 1)));
      imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + noiseByte(idx, 2)));
    }
    return imageData;
  }

  // --- Canvas fingerprint resistance: cover all three extraction vectors ---
  // (getImageData, toDataURL, toBlob) rather than just one, and do it via a
  // scratch copy so the page's own visible canvas is never mutated.
  try {
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function patchedGetImageData(sx, sy, ...rest) {
      const imageData = origGetImageData.call(this, sx, sy, ...rest);
      return addNoiseToImageData(imageData, sx, sy);
    };

    function noisyScratchOf(canvas) {
      const ctx2d = canvas.getContext && canvas.getContext('2d');
      if (!ctx2d) return null; // WebGL/bitmaprenderer canvases are out of scope for this pass
      const scratch = document.createElement('canvas');
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const scratchCtx = scratch.getContext('2d');
      scratchCtx.drawImage(canvas, 0, 0);
      const imageData = addNoiseToImageData(scratchCtx.getImageData(0, 0, scratch.width, scratch.height), 0, 0);
      scratchCtx.putImageData(imageData, 0, 0);
      return scratch;
    }

    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function patchedToDataURL(...args) {
      const scratch = noisyScratchOf(this);
      return scratch ? origToDataURL.apply(scratch, args) : origToDataURL.apply(this, args);
    };

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function patchedToBlob(callback, ...args) {
      const scratch = noisyScratchOf(this);
      return scratch ? origToBlob.call(scratch, callback, ...args) : origToBlob.call(this, callback, ...args);
    };
  } catch (err) { /* non-fatal */ }

  // --- Audio-context fingerprint resistance ---
  // Audio fingerprinting hashes the exact samples an AudioBuffer/AnalyserNode
  // produces (often via OfflineAudioContext rendering); nudging those samples
  // by an amount far below audible/analytical significance breaks exact-match
  // hashing while leaving real playback and legitimate analysis unaffected.
  try {
    if (window.AudioBuffer) {
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function patchedGetChannelData(channel) {
        const data = origGetChannelData.call(this, channel);
        for (let i = 0; i < data.length; i += 97) {
          data[i] += noiseSample(i, channel);
        }
        return data;
      };
    }

    if (window.AnalyserNode) {
      const patchAnalyser = (methodName, noiseFn, clamp) => {
        const orig = AnalyserNode.prototype[methodName];
        if (!orig) return;
        AnalyserNode.prototype[methodName] = function patched(array) {
          orig.call(this, array);
          for (let i = 0; i < array.length; i++) {
            array[i] = clamp(array[i] + noiseFn(i, 0));
          }
        };
      };
      const clampByte = (v) => Math.min(255, Math.max(0, Math.round(v)));
      const clampUnit = (v) => Math.min(1, Math.max(-1, v));
      patchAnalyser('getByteFrequencyData', noiseDb, clampByte);
      patchAnalyser('getFloatFrequencyData', noiseDb, (v) => v);
      patchAnalyser('getByteTimeDomainData', noiseByte, clampByte);
      patchAnalyser('getFloatTimeDomainData', noiseSample, clampUnit);
    }
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

  // --- User-Agent Client Hints (JS-visible, not just the HTTP headers
  // main.js normalizes) - navigator.userAgentData.brands/platform and
  // getHighEntropyValues() can reveal the real Chromium version/platform
  // even when the User-Agent string itself is spoofed, which is exactly the
  // kind of header-vs-JS mismatch that trips bot-detection systems like
  // Cloudflare (see docs/THREAT_MODEL.md). ---
  try {
    if (navigator.userAgentData) {
      const brands = [
        { brand: 'Not.A/Brand', version: '8' },
        { brand: 'Chromium', version: '124' },
        { brand: 'Google Chrome', version: '124' },
      ];
      safeDefine(Navigator.prototype, 'userAgentData', () => ({
        brands,
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: (hints) =>
          Promise.resolve(
            Object.fromEntries(
              [
                ['brands', brands],
                ['mobile', false],
                ['platform', 'Windows'],
                ['platformVersion', '10.0.0'],
                ['architecture', 'x86'],
                ['bitness', '64'],
                ['model', ''],
                ['uaFullVersion', '124.0.0.0'],
                ['fullVersionList', brands.map((b) => ({ ...b, version: `${b.version}.0.0.0` }))],
              ].filter(([key]) => !hints || hints.includes(key))
            )
          ),
        toJSON: () => ({ brands, mobile: false, platform: 'Windows' }),
      }));
    }
  } catch (err) { /* non-fatal */ }

  // --- Screen/viewport size rounding (coarse "letterboxing"-style bucketing,
  // like Tor Browser's window-size quantization). Read once at page-load time
  // since these preloads run per-navigation; JS reads get the bucketed value,
  // while actual CSS layout (which uses the real viewport, not this property)
  // is untouched. ---
  const bucket = (value, step) => Math.floor(value / step) * step;
  try {
    const widthDesc = Object.getOwnPropertyDescriptor(Screen.prototype, 'width');
    const heightDesc = Object.getOwnPropertyDescriptor(Screen.prototype, 'height');
    const origWidth = widthDesc.get.call(window.screen);
    const origHeight = heightDesc.get.call(window.screen);
    safeDefine(Screen.prototype, 'width', () => bucket(origWidth, 100));
    safeDefine(Screen.prototype, 'height', () => bucket(origHeight, 100));
  } catch (err) { /* non-fatal */ }

  try {
    // Unlike screen.width/height, innerWidth/innerHeight are own properties
    // of the window instance in Chromium (not on Window.prototype), so the
    // override has to target `window` directly.
    const origInnerWidth = window.innerWidth;
    const origInnerHeight = window.innerHeight;
    safeDefine(window, 'innerWidth', () => bucket(origInnerWidth, 100));
    safeDefine(window, 'innerHeight', () => bucket(origInnerHeight, 100));
  } catch (err) { /* non-fatal */ }

  // --- Cosmetic/element-hiding rules from enabled filter-list subscriptions ---
  // Asks the main process for this hostname's CSS-hiding selectors (see
  // filter-list-store.js's cosmeticRules) and injects them as a <style> tag.
  // Best-effort: a brief flash of the hidden element before the stylesheet
  // attaches is possible, same tradeoff cosmetic filtering makes elsewhere.
  try {
    const { ipcRenderer } = require('electron');
    const applyCosmeticHiding = async () => {
      try {
        const selectors = await ipcRenderer.invoke('adblock:cosmetic-rules-for-host', location.hostname);
        if (!selectors || selectors.length === 0) return;
        const style = document.createElement('style');
        style.textContent = selectors.map((s) => `${s}{display:none!important}`).join('\n');
        (document.head || document.documentElement).appendChild(style);
      } catch (err) { /* non-fatal */ }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyCosmeticHiding, { once: true });
    } else {
      applyCosmeticHiding();
    }
  } catch (err) { /* non-fatal */ }
})();
