'use strict';

const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NUM_ISOLATED_PORTS = 6;
const SOCKS_BASE_PORT = 19050;
const CONTROL_PORT = 19151;

/**
 * A bundled binary (fetched + sha256-verified by scripts/fetch-tor-binaries.js
 * - see that file and resources/tor/manifest.json) is preferred over a
 * system install so Dago doesn't depend on the user having installed Tor
 * separately. Nothing is bundled by default in this repo; this just checks
 * whether a maintainer's build pipeline has populated
 * resources/tor/bin/<platform>-<arch>/tor(.exe) - if not, this falls back to
 * whatever `tor` resolves to on PATH, same as before this existed.
 */
function bundledTorPath() {
  const platformKey = `${process.platform}-${process.arch}`;
  const binaryName = process.platform === 'win32' ? 'tor.exe' : 'tor';
  const candidate = path.join(__dirname, '..', '..', 'resources', 'tor', 'bin', platformKey, binaryName);
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Tor Browser bundles its own private copy of `tor`, but deliberately does
 * NOT put it on PATH - it's meant to be launched only by Tor Browser itself,
 * not used as a general system service. That means a user who already has
 * Tor Browser installed (very common - it's how most people first get Tor)
 * still gets "Tor: unavailable" from a plain PATH lookup, which is
 * confusing when Tor so clearly *is* on their machine. These are the
 * well-known default install locations for each OS; if the official
 * installer/extractor was used with defaults, one of these exists.
 */
function torBrowserCandidatePaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      path.join(home, 'Desktop', 'Tor Browser', 'Browser', 'TorBrowser', 'Tor', 'tor.exe'),
      path.join(home, 'Downloads', 'Tor Browser', 'Browser', 'TorBrowser', 'Tor', 'tor.exe'),
      'C:\\Program Files\\Tor Browser\\Browser\\TorBrowser\\Tor\\tor.exe',
      'C:\\Program Files (x86)\\Tor Browser\\Browser\\TorBrowser\\Tor\\tor.exe',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Tor Browser.app/Contents/Resources/TorBrowser/Tor/tor',
      path.join(home, 'Applications', 'Tor Browser.app', 'Contents', 'Resources', 'TorBrowser', 'Tor', 'tor'),
    ];
  }
  // Linux: the official tarball is usually extracted straight to the home
  // directory; torbrowser-launcher (common on Debian/Ubuntu/Fedora) installs
  // under ~/.local/share/torbrowser instead.
  return [
    path.join(home, 'tor-browser', 'Browser', 'TorBrowser', 'Tor', 'tor'),
    path.join(home, 'tor-browser_en-US', 'Browser', 'TorBrowser', 'Tor', 'tor'),
    path.join(home, '.local', 'share', 'torbrowser', 'tbb', 'x86_64', 'tor-browser', 'Browser', 'TorBrowser', 'Tor', 'tor'),
    path.join(home, '.local', 'share', 'torbrowser', 'tbb', 'i686', 'tor-browser', 'Browser', 'TorBrowser', 'Tor', 'tor'),
    '/opt/tor-browser/Browser/TorBrowser/Tor/tor',
  ];
}

function findTorBrowserBinary() {
  return torBrowserCandidatePaths().find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * On Linux and macOS, Tor Browser ships its own private copies of libevent/
 * OpenSSL alongside the `tor` binary specifically so it doesn't depend on
 * (and potentially conflict with) whatever the system has installed. Its own
 * launcher sets the dynamic linker's search path to that directory before
 * running it; spawning the binary directly without doing the same can fail
 * to find those libraries. Only needed for paths we located ourselves
 * (bundled or Tor-Browser-detected) - a plain `tor` resolved from PATH is
 * assumed to be a normal system package that resolves its own libraries.
 */
function envForTorBinary(torBinaryPath) {
  if (torBinaryPath === 'tor') return process.env;
  const dir = path.dirname(torBinaryPath);
  const env = { ...process.env };
  if (process.platform === 'linux') {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH ? `${dir}:${env.LD_LIBRARY_PATH}` : dir;
  } else if (process.platform === 'darwin') {
    env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH ? `${dir}:${env.DYLD_LIBRARY_PATH}` : dir;
  }
  return env;
}

class TorManager {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.torDataDir = path.join(userDataDir, 'tor-data');
    this.torrcPath = path.join(userDataDir, 'torrc');
    this.process = null;
    this.available = false;
    this.bootstrapped = false;
    this.ports = [];
    for (let i = 0; i < NUM_ISOLATED_PORTS; i++) this.ports.push(SOCKS_BASE_PORT + i);
    this.nextPortIndex = 0;
    // Preference order: a maintainer-fetched bundled binary, then whatever
    // `tor` resolves to on PATH (a normal system install), then a detected
    // Tor Browser install as a last resort - it works fine as a plain Tor
    // daemon, but PATH/system installs are more likely to stay up to date
    // via the OS's own package manager.
    this.torBinaryCandidates = [bundledTorPath(), 'tor', findTorBrowserBinary()].filter(Boolean);
    this.torBinary = this.torBinaryCandidates[0];
    this.torBinarySource = null;
  }

  /**
   * Probes each candidate binary in order and remembers the first one that
   * actually runs, so `start()` doesn't have to repeat this search. Returns
   * true if any candidate is usable.
   */
  async isTorInstalled() {
    for (const candidate of this.torBinaryCandidates) {
      const works = await new Promise((resolve) => {
        const probe = spawn(candidate, ['--version'], { env: envForTorBinary(candidate) });
        let ok = false;
        probe.on('error', () => resolve(false));
        probe.stdout.on('data', () => { ok = true; });
        probe.on('close', () => resolve(ok));
      });
      if (works) {
        this.torBinary = candidate;
        this.torBinarySource = candidate === 'tor' ? 'path' : (candidate === bundledTorPath() ? 'bundled' : 'tor-browser');
        return true;
      }
    }
    return false;
  }

  _writeTorrc() {
    if (!fs.existsSync(this.torDataDir)) fs.mkdirSync(this.torDataDir, { recursive: true });
    const lines = [
      `DataDirectory ${this.torDataDir}`,
      `ControlPort ${CONTROL_PORT}`,
      `CookieAuthentication 1`,
      `AvoidDiskWrites 1`,
      `ClientOnly 1`,
      // One SocksPort per isolation slot. IsolateSOCKSAuth + IsolateDestAddr force
      // a distinct circuit per slot, and since each Dago tab is pinned to its own
      // slot, tabs never share a circuit the way Tor Browser tabs can.
    ];
    for (const port of this.ports) {
      lines.push(`SocksPort ${port} IsolateSOCKSAuth IsolateDestAddr IsolateDestPort`);
    }
    fs.writeFileSync(this.torrcPath, lines.join('\n') + '\n');
  }

  /** Launches the tor daemon and resolves once it reports 100% bootstrap. */
  async start() {
    const installed = await this.isTorInstalled();
    if (!installed) {
      this.available = false;
      return { available: false, reason: 'tor-not-installed' };
    }

    this._writeTorrc();

    return new Promise((resolve) => {
      this.process = spawn(this.torBinary, ['-f', this.torrcPath], { env: envForTorBinary(this.torBinary) });
      let settled = false;

      const onData = (buf) => {
        const text = buf.toString();
        if (text.includes('Bootstrapped 100%')) {
          this.available = true;
          this.bootstrapped = true;
          if (!settled) { settled = true; resolve({ available: true, source: this.torBinarySource }); }
        }
      };

      this.process.stdout.on('data', onData);
      this.process.stderr.on('data', onData);
      this.process.on('error', (err) => {
        if (!settled) { settled = true; resolve({ available: false, reason: err.message }); }
      });
      this.process.on('close', () => {
        this.available = false;
        this.bootstrapped = false;
      });

      // Don't hang forever if tor never reports bootstrap (e.g. no network).
      setTimeout(() => {
        if (!settled) { settled = true; resolve({ available: false, reason: 'bootstrap-timeout' }); }
      }, 30000);
    });
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  /** Assigns the next isolation slot (round-robin) to a newly opened tab. */
  assignPortForTab() {
    const port = this.ports[this.nextPortIndex % this.ports.length];
    this.nextPortIndex++;
    return port;
  }

  proxyRulesForPort(port) {
    return `socks5://127.0.0.1:${port}`;
  }

  /** Sends SIGNAL NEWNYM over the control port to force fresh circuits ("New Identity"). */
  async newIdentity() {
    if (!this.available) return { ok: false, reason: 'tor-unavailable' };
    const cookiePath = path.join(this.torDataDir, 'control_auth_cookie');
    let authHex;
    try {
      authHex = fs.readFileSync(cookiePath).toString('hex');
    } catch (err) {
      return { ok: false, reason: 'no-auth-cookie' };
    }

    return new Promise((resolve) => {
      const socket = net.createConnection(CONTROL_PORT, '127.0.0.1', () => {
        socket.write(`AUTHENTICATE ${authHex}\r\n`);
      });
      let stage = 0;
      socket.on('data', (data) => {
        const text = data.toString();
        if (stage === 0 && text.startsWith('250')) {
          stage = 1;
          socket.write('SIGNAL NEWNYM\r\n');
        } else if (stage === 1) {
          socket.end();
          resolve({ ok: text.startsWith('250') });
        }
      });
      socket.on('error', (err) => resolve({ ok: false, reason: err.message }));
    });
  }
}

module.exports = { TorManager, NUM_ISOLATED_PORTS };
