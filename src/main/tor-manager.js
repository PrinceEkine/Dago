'use strict';

const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const NUM_ISOLATED_PORTS = 6;
const SOCKS_BASE_PORT = 19050;
const CONTROL_PORT = 19151;

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
  }

  /** Returns true if a `tor` binary is reachable on PATH. */
  async isTorInstalled() {
    return new Promise((resolve) => {
      const probe = spawn('tor', ['--version']);
      let ok = false;
      probe.on('error', () => resolve(false));
      probe.stdout.on('data', () => { ok = true; });
      probe.on('close', () => resolve(ok));
    });
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
      this.process = spawn('tor', ['-f', this.torrcPath]);
      let settled = false;

      const onData = (buf) => {
        const text = buf.toString();
        if (text.includes('Bootstrapped 100%')) {
          this.available = true;
          this.bootstrapped = true;
          if (!settled) { settled = true; resolve({ available: true }); }
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
