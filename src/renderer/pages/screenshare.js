'use strict';

const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

// "ideal" hints passed to getDisplayMedia - the browser/OS capture pipeline
// may not honor them exactly (e.g. a 720p source can't be upscaled to
// 1080p), which is why the UI describes these as requests, not guarantees.
const QUALITY_PRESETS = {
  auto: true,
  balanced: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  'data-saver': { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15 } },
};

const serverUrlInput = document.getElementById('server-url');
const tabShareBtn = document.getElementById('tab-share');
const tabWatchBtn = document.getElementById('tab-watch');
const sharePanel = document.getElementById('share-panel');
const watchPanel = document.getElementById('watch-panel');

const sourceListEl = document.getElementById('source-list');
const qualitySelect = document.getElementById('quality-select');
const startShareBtn = document.getElementById('start-share-btn');
const shareActiveEl = document.getElementById('share-active');
const roomCodeDisplay = document.getElementById('room-code-display');
const copyRoomCodeBtn = document.getElementById('copy-room-code-btn');
const viewerCountStatus = document.getElementById('viewer-count-status');
const stopShareBtn = document.getElementById('stop-share-btn');
const localVideo = document.getElementById('local-video');
const shareStatus = document.getElementById('share-status');

const roomCodeInput = document.getElementById('room-code-input');
const watchBtn = document.getElementById('watch-btn');
const watchStatus = document.getElementById('watch-status');
const watchConnectionStatus = document.getElementById('watch-connection-status');
const remoteVideo = document.getElementById('remote-video');

let selectedSourceId = null;
let ws = null;
let localStream = null;
// Host side: one RTCPeerConnection per connected viewer, since a single
// screen is fanned out P2P to each viewer separately - there is no server-
// side media relay/transcoding here, only signaling.
const viewerConnections = new Map(); // viewerId -> RTCPeerConnection
// Viewer side: a single connection to the one host.
let viewerPc = null;

function switchTab(mode) {
  sharePanel.classList.toggle('hidden', mode !== 'share');
  watchPanel.classList.toggle('hidden', mode !== 'watch');
  tabShareBtn.classList.toggle('primary', mode === 'share');
  tabWatchBtn.classList.toggle('primary', mode === 'watch');
}
tabShareBtn.addEventListener('click', () => switchTab('share'));
tabWatchBtn.addEventListener('click', () => switchTab('watch'));
switchTab('share');

function connectSignaling() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(serverUrlInput.value.trim());
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('Could not reach signaling server.')));
  });
}

function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Without a TURN server, screensharing connects directly peer-to-peer via
// STUN alone, which reveals both peers' public IP addresses to each other -
// inherent to how P2P WebRTC works, not a Dago-specific leak. Configuring a
// TURN relay in Settings routes media through it instead; "force relay"
// (iceTransportPolicy: 'relay') refuses to negotiate direct candidates at
// all, so a peer only ever learns the TURN server's address.
async function buildRtcConfig() {
  const iceServers = [...STUN_SERVERS];
  const relay = await window.dago.webrtc.getRelayConfig();
  if (relay.enabled && relay.url) {
    iceServers.push({
      urls: relay.url,
      username: relay.username || undefined,
      credential: relay.credential || undefined,
    });
  }
  const iceTransportPolicy = relay.enabled && relay.forceRelay ? 'relay' : 'all';
  return { iceServers, iceTransportPolicy };
}

/**
 * Wires up ICE connection state tracking on a peer connection, including a
 * best-effort auto-recovery attempt on 'failed'. restartIce() only actually
 * triggers new ICE negotiation on the side that creates offers - on this
 * feature that's always the host, so a viewer's connection recovering after
 * a network blip depends on the HOST's restartIce() producing a fresh offer,
 * not anything the viewer side can trigger itself.
 */
function watchConnectionState(pc, onChange) {
  pc.addEventListener('iceconnectionstatechange', () => {
    onChange(pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed' && typeof pc.restartIce === 'function') {
      pc.restartIce();
    }
  });
}

// --- Host / share flow ---

async function loadSources() {
  const sources = await window.dago.screenshare.getSources();
  sourceListEl.innerHTML = '';
  sources.forEach((source) => {
    const item = document.createElement('div');
    item.className = 'source-item';
    item.innerHTML = `<img src="${source.thumbnailDataUrl}" alt="" /><span>${escapeHtml(source.name)}</span>`;
    item.addEventListener('click', () => {
      selectedSourceId = source.id;
      sourceListEl.querySelectorAll('.source-item').forEach((el) => el.style.background = '');
      item.style.background = '#3b4261';
    });
    sourceListEl.appendChild(item);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateViewerCountStatus() {
  const n = viewerConnections.size;
  viewerCountStatus.textContent = n === 0 ? 'No viewers yet.' : `${n} viewer${n === 1 ? '' : 's'} connected.`;
}

/** Creates a fresh offer for one viewer and sends it, tagged with that viewer's id. */
async function createViewerConnection(viewerId) {
  const pc = new RTCPeerConnection(await buildRtcConfig());
  viewerConnections.set(viewerId, pc);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  pc.onicecandidate = (e) => {
    if (e.candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate, targetViewerId: viewerId }));
  };
  watchConnectionState(pc, () => updateViewerCountStatus());
  pc.addEventListener('connectionstatechange', () => {
    if (['closed', 'failed'].includes(pc.connectionState)) {
      viewerConnections.delete(viewerId);
      updateViewerCountStatus();
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', sdp: offer, targetViewerId: viewerId }));
  updateViewerCountStatus();
}

startShareBtn.addEventListener('click', async () => {
  shareStatus.textContent = '';
  if (!selectedSourceId) {
    shareStatus.textContent = 'Pick a screen or window to share first.';
    return;
  }

  try {
    await window.dago.screenshare.selectSource(selectedSourceId);
    // Screen/window capture only - getUserMedia (camera/mic) is never called
    // anywhere in this flow, which is what keeps this feature call-free.
    const videoConstraint = QUALITY_PRESETS[qualitySelect.value] ?? true;
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraint, audio: false });
  } catch (err) {
    shareStatus.textContent = `Could not capture screen: ${err.message}`;
    return;
  }

  localVideo.srcObject = localStream;

  const room = randomRoomCode();
  try {
    ws = await connectSignaling();
  } catch (err) {
    shareStatus.textContent = err.message;
    return;
  }

  ws.addEventListener('message', async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'viewer-joined') {
      await createViewerConnection(msg.viewerId);
    } else if (msg.type === 'answer' && msg.fromViewerId) {
      const pc = viewerConnections.get(msg.fromViewerId);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    } else if (msg.type === 'ice-candidate' && msg.candidate && msg.fromViewerId) {
      const pc = viewerConnections.get(msg.fromViewerId);
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } else if (msg.type === 'viewer-left') {
      const pc = viewerConnections.get(msg.viewerId);
      if (pc) pc.close();
      viewerConnections.delete(msg.viewerId);
      updateViewerCountStatus();
    }
  });

  ws.send(JSON.stringify({ type: 'host', room }));
  roomCodeDisplay.textContent = room;
  shareActiveEl.classList.remove('hidden');
  startShareBtn.disabled = true;
  updateViewerCountStatus();

  localStream.getVideoTracks()[0].addEventListener('ended', stopSharing);
});

copyRoomCodeBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(roomCodeDisplay.textContent);
    const original = copyRoomCodeBtn.textContent;
    copyRoomCodeBtn.textContent = 'Copied!';
    setTimeout(() => { copyRoomCodeBtn.textContent = original; }, 1500);
  } catch (err) {
    // Clipboard access can fail if the window lost focus - not worth
    // surfacing as an error, the room code is right there to copy by hand.
  }
});

function stopSharing() {
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  for (const pc of viewerConnections.values()) pc.close();
  viewerConnections.clear();
  if (ws) ws.close();
  localStream = null;
  ws = null;
  shareActiveEl.classList.add('hidden');
  startShareBtn.disabled = false;
  localVideo.srcObject = null;
}

stopShareBtn.addEventListener('click', stopSharing);

// --- Viewer / watch flow ---

watchBtn.addEventListener('click', async () => {
  watchStatus.textContent = '';
  watchConnectionStatus.textContent = '';
  const room = roomCodeInput.value.trim().toUpperCase();
  if (!room) {
    watchStatus.textContent = 'Enter a room code.';
    return;
  }

  try {
    ws = await connectSignaling();
  } catch (err) {
    watchStatus.textContent = err.message;
    return;
  }

  viewerPc = new RTCPeerConnection(await buildRtcConfig());
  viewerPc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };
  viewerPc.onicecandidate = (e) => {
    if (e.candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
  };
  watchConnectionState(viewerPc, (state) => {
    const labels = {
      checking: 'Connecting…',
      connected: 'Connected.',
      completed: 'Connected.',
      disconnected: 'Connection lost, trying to recover…',
      failed: 'Connection failed. Ask the host to check their network, or Watch again.',
      closed: '',
    };
    watchConnectionStatus.textContent = labels[state] ?? '';
  });

  ws.addEventListener('message', async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'error') {
      watchStatus.textContent = msg.message;
    } else if (msg.type === 'offer') {
      await viewerPc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await viewerPc.createAnswer();
      await viewerPc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
    } else if (msg.type === 'ice-candidate' && msg.candidate) {
      await viewerPc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } else if (msg.type === 'host-left') {
      watchStatus.textContent = 'Host stopped sharing.';
      watchConnectionStatus.textContent = '';
      remoteVideo.srcObject = null;
    }
  });

  ws.send(JSON.stringify({ type: 'join', room }));
});

loadSources();
