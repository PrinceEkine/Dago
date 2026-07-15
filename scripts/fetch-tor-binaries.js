#!/usr/bin/env node
'use strict';

/**
 * Maintainer-run tool to fetch and verify Tor Expert Bundle binaries so
 * Dago can ship a bundled Tor instead of requiring a system install (see
 * docs/ROADMAP.md). This is NOT run automatically by `npm install` or by
 * Dago itself - it requires network access to dist.torproject.org, which
 * this project's own dev sandbox does not have (confirmed: a direct HTTPS
 * check to dist.torproject.org came back 403 from the sandbox's egress
 * policy). A maintainer with real network access runs this by hand, after
 * filling in resources/tor/manifest.json with a version/URL/sha256 they've
 * personally verified against the Tor Project's PGP signature - see that
 * file's _readme for the exact steps. This script deliberately refuses to
 * do anything if that verification step was skipped.
 *
 * Usage:
 *   node scripts/fetch-tor-binaries.js [platform-key ...]
 *   (defaults to the current machine's platform-arch if none given)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

const MANIFEST_PATH = path.join(__dirname, '..', 'resources', 'tor', 'manifest.json');
const BIN_DIR = path.join(__dirname, '..', 'resources', 'tor', 'bin');

function currentPlatformKey() {
  return `${process.platform}-${process.arch}`;
}

function loadManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!manifest.version || manifest.version === 'PLACEHOLDER') {
    throw new Error(
      `${MANIFEST_PATH} still has the placeholder version. Fill in a verified ` +
      `release per that file's _readme before running this script.`
    );
  }
  return manifest;
}

function downloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          downloadToFile(res.headers.location, destPath).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', reject);
  });
}

function sha256Of(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function extract(archivePath, destDir, platformKey) {
  fs.mkdirSync(destDir, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-Command', `Expand-Archive -Force -Path "${archivePath}" -DestinationPath "${destDir}"`]);
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', destDir]);
    }
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    execFileSync('tar', ['-xzf', archivePath, '-C', destDir]);
  } else {
    throw new Error(`Don't know how to extract ${archivePath} - expected .zip or .tar.gz`);
  }
  if (platformKey.startsWith('win32')) return;
  const torBinary = path.join(destDir, 'tor');
  if (fs.existsSync(torBinary)) fs.chmodSync(torBinary, 0o755);
}

async function fetchPlatform(manifest, platformKey) {
  const entry = manifest.platforms[platformKey];
  if (!entry) throw new Error(`Unknown platform key "${platformKey}". Valid keys: ${Object.keys(manifest.platforms).join(', ')}`);
  if (!entry.url || !entry.sha256) {
    throw new Error(
      `resources/tor/manifest.json has no url/sha256 for "${platformKey}" yet. ` +
      `See that file's _readme for how to fill it in safely - this script will ` +
      `not download anything without a checksum to verify against.`
    );
  }

  console.log(`[${platformKey}] downloading ${entry.url} ...`);
  const tmpPath = path.join(BIN_DIR, `_download-${platformKey}${path.extname(entry.url)}`);
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await downloadToFile(entry.url, tmpPath);

  const actualSha256 = sha256Of(tmpPath);
  if (actualSha256 !== entry.sha256.toLowerCase()) {
    fs.unlinkSync(tmpPath);
    throw new Error(
      `[${platformKey}] sha256 mismatch!\n  expected: ${entry.sha256}\n  got:      ${actualSha256}\n` +
      `Refusing to install this file - either the manifest entry is wrong or the download was tampered with.`
    );
  }
  console.log(`[${platformKey}] sha256 verified.`);

  const destDir = path.join(BIN_DIR, platformKey);
  extract(tmpPath, destDir, platformKey);
  fs.unlinkSync(tmpPath);
  console.log(`[${platformKey}] extracted to ${destDir}`);
}

async function main() {
  const manifest = loadManifest();
  const requested = process.argv.slice(2);
  const platformKeys = requested.length > 0 ? requested : [currentPlatformKey()];

  for (const key of platformKeys) {
    await fetchPlatform(manifest, key);
  }
  console.log('Done. tor-manager.js will pick up the bundled binary automatically on next launch.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
