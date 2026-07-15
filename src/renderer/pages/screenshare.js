'use strict';

const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const serverUrlInput = document.getElementById('server-url');
const tabShareBtn = document.getElementById('tab-share');
const tabWatchBtn = document.getElementById('tab-watch');
const sharePanel = document.getElementById('share-panel');
const watchPanel = document.getElementById('watch-panel');

const sourceListEl = document.getElementById('source-list');
const startShareBtn = document.getElementById('start-share-btn');
const shareActiveEl = document.getElementById('share-active');
const roomCodeDisplay = document.getElementById('room-code-display');
const stopShareBtn = document.getElementById('stop-share-btn');
const localVideo = document.getElementById('local-video');
const shareStatus = document.getElementById('share-status');

const roomCodeInput = document.getElementById('room-code-input');
const watchBtn = document.getElementById('watch-btn');
const watchStatus = document.getElementById('watch-status');
const remoteVideo = document.getElementById('remote-video');

let selectedSourceId = null;
let ws = null;
let pc = null;
let localStream = null;

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
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
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

  pc = new RTCPeerConnection(await buildRtcConfig());
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  pc.onicecandidate = (e) => {
    if (e.candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
  };

  ws.addEventListener('message', async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'viewer-joined') {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'offer', sdp: offer }));
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    } else if (msg.type === 'ice-candidate' && msg.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } else if (msg.type === 'peer-left') {
      shareStatus.textContent = 'Viewer disconnected.';
    }
  });

  ws.send(JSON.stringify({ type: 'host', room }));
  roomCodeDisplay.textContent = room;
  shareActiveEl.classList.remove('hidden');
  startShareBtn.disabled = true;

  localStream.getVideoTracks()[0].addEventListener('ended', stopSharing);
});

function stopSharing() {
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  if (pc) pc.close();
  if (ws) ws.close();
  localStream = null;
  pc = null;
  ws = null;
  shareActiveEl.classList.add('hidden');
  startShareBtn.disabled = false;
  localVideo.srcObject = null;
}

stopShareBtn.addEventListener('click', stopSharing);

// --- Viewer / watch flow ---

watchBtn.addEventListener('click', async () => {
  watchStatus.textContent = '';
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

  pc = new RTCPeerConnection(await buildRtcConfig());
  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
  };

  ws.addEventListener('message', async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'error') {
      watchStatus.textContent = msg.message;
    } else if (msg.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
    } else if (msg.type === 'ice-candidate' && msg.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } else if (msg.type === 'peer-left') {
      watchStatus.textContent = 'Host stopped sharing.';
      remoteVideo.srcObject = null;
    }
  });

  ws.send(JSON.stringify({ type: 'join', room }));
});

loadSources();
