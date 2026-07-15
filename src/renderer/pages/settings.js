'use strict';

const torDesc = document.getElementById('tor-desc');
const adblockDesc = document.getElementById('adblock-desc');
const versionDesc = document.getElementById('version-desc');
const resetPinBtn = document.getElementById('reset-pin-btn');

async function refreshTorStatus(status) {
  torDesc.textContent = status.available
    ? 'Connected. Each tab is routed through its own isolated Tor circuit.'
    : `Not active (${status.reason || 'tor not installed'}). Install Tor and restart Dago to enable onion routing.`;
}

window.dago.tor.getStatus().then(refreshTorStatus);
window.dago.tor.onStatusChanged(refreshTorStatus);

window.dago.adblock.stats().then(({ domainCount }) => {
  adblockDesc.textContent = `Enabled - blocking ${domainCount} known ad/tracker domains by default.`;
});

window.dago.app.getVersion().then((version) => {
  versionDesc.textContent = `Dago ${version} (alpha)`;
});

resetPinBtn.addEventListener('click', async () => {
  const unlocked = await window.dago.history.isUnlocked();
  if (!unlocked) {
    alert('Unlock History with your current PIN first (open History from the toolbar), then come back here to reset it.');
    return;
  }
  if (!confirm('Reset your history PIN? You will be asked to set a new one next time you open History.')) return;
  await window.dago.history.resetPin();
  alert('PIN reset. You will be asked to set a new one next time you open History.');
});
