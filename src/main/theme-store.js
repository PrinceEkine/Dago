'use strict';

const fs = require('fs');
const path = require('path');

const THEME_SETTINGS = ['system', 'light', 'dark'];
const DEFAULT_SETTING = 'system';

// Window background colors match the CSS --bg variable for each resolved
// theme, so a window never flashes white (or the wrong theme) while its
// page is still loading.
const WINDOW_BACKGROUND = { light: '#e6e7ed', dark: '#1a1b26' };

/**
 * Light/dark/system appearance setting for Dago's own UI (tab chrome,
 * utility windows, new-tab page - never web content). The resolved theme
 * is stamped into each UI page's URL (?dago-theme=...) at load time and
 * broadcast live on change; theme-init.js applies both ends. `system`
 * follows the OS via nativeTheme (which also themes native controls and
 * scrollbars through themeSource).
 */
class ThemeStore {
  constructor(userDataDir, nativeTheme) {
    this.filePath = path.join(userDataDir, 'theme.json');
    this.nativeTheme = nativeTheme;
    this.setting = this._load();
    this._apply();
  }

  _load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (THEME_SETTINGS.includes(data.theme)) return data.theme;
      } catch (err) {
        // fall through to default
      }
    }
    return DEFAULT_SETTING;
  }

  _persist() {
    fs.writeFileSync(this.filePath, JSON.stringify({ theme: this.setting }));
  }

  _apply() {
    this.nativeTheme.themeSource = this.setting;
  }

  get resolved() {
    return this.nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  get() {
    return { setting: this.setting, resolved: this.resolved };
  }

  set(setting) {
    if (!THEME_SETTINGS.includes(setting)) return { ok: false, reason: 'Unknown theme.' };
    this.setting = setting;
    this._persist();
    this._apply();
    return { ok: true, ...this.get() };
  }

  /** Fires when the resolved theme changes underneath the setting (OS appearance changed). */
  onResolvedChange(callback) {
    this.nativeTheme.on('updated', () => callback(this.get()));
  }

  windowBackgroundColor() {
    return WINDOW_BACKGROUND[this.resolved];
  }
}

module.exports = { ThemeStore, THEME_SETTINGS, WINDOW_BACKGROUND };
