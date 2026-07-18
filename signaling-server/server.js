'use strict';

/**
 * Minimal WebRTC signaling relay for Dago's in-app screensharing feature.
 *
 * This server never sees screen content - it only relays SDP offers/answers
 * and ICE candidates between a "host" sharing their screen and any number of
 * "viewers" watching it, so each host/viewer pair can establish its own
 * direct peer-to-peer WebRTC connection (the host sends the same screen to
 * every viewer, but each gets a separate PeerConnection/circuit - this
 * server only ever relays signaling messages, never video). Rooms are
 * ephemeral, in-memory, and identified by a short code; nothing is
 * persisted to disk.
 *
 * Run with: node signaling-server/server.js
 * Configure the port with the PORT env var (default 8089).
 */

const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8089;
// A host's upload bandwidth is split across every connected viewer (this is
// P2P, not a media server that transcodes/fans out server-side) - capping
// viewer count protects a host from a leaked or guessed room code letting
// unbounded strangers join and degrade the share for everyone, including
// the intended viewer(s).
const MAX_VIEWERS_PER_ROOM = 8;

const rooms = new Map(); // code -> { host: ws|null, viewers: Map<viewerId, ws> }

const wss = new WebSocketServer({ port: PORT });

function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

wss.on('connection', (ws) => {
  ws.room = null;
  ws.role = null;
  ws.viewerId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }

    if (msg.type === 'host') {
      const code = msg.room;
      if (!rooms.has(code)) rooms.set(code, { host: null, viewers: new Map() });
      const room = rooms.get(code);
      room.host = ws;
      ws.room = code;
      ws.role = 'host';
      send(ws, { type: 'hosting', room: code });
      return;
    }

    if (msg.type === 'join') {
      const code = msg.room;
      const room = rooms.get(code);
      if (!room || !room.host) {
        send(ws, { type: 'error', message: 'No active share with that code.' });
        return;
      }
      if (room.viewers.size >= MAX_VIEWERS_PER_ROOM) {
        send(ws, { type: 'error', message: 'This share already has the maximum number of viewers.' });
        return;
      }
      const viewerId = crypto.randomUUID();
      room.viewers.set(viewerId, ws);
      ws.room = code;
      ws.role = 'viewer';
      ws.viewerId = viewerId;
      send(ws, { type: 'joined', viewerId });
      send(room.host, { type: 'viewer-joined', viewerId });
      return;
    }

    const room = rooms.get(ws.room);
    if (!room) return;

    // Host -> a specific viewer: the host keeps one PeerConnection per
    // viewer, so it must say which one this offer/candidate is for.
    if (ws.role === 'host' && ['offer', 'ice-candidate'].includes(msg.type)) {
      const viewerWs = room.viewers.get(msg.targetViewerId);
      send(viewerWs, { type: msg.type, sdp: msg.sdp, candidate: msg.candidate });
      return;
    }

    // Viewer -> host: there's only one host, but it needs to know which of
    // its several PeerConnections this answer/candidate belongs to.
    if (ws.role === 'viewer' && ['answer', 'ice-candidate'].includes(msg.type)) {
      send(room.host, { type: msg.type, sdp: msg.sdp, candidate: msg.candidate, fromViewerId: ws.viewerId });
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;

    if (ws.role === 'host' && room.host === ws) {
      // A share has exactly one source - without the host there's nothing
      // left for any viewer to watch, so the whole room ends.
      for (const viewerWs of room.viewers.values()) send(viewerWs, { type: 'host-left' });
      rooms.delete(ws.room);
      return;
    }

    if (ws.role === 'viewer' && room.viewers.get(ws.viewerId) === ws) {
      room.viewers.delete(ws.viewerId);
      send(room.host, { type: 'viewer-left', viewerId: ws.viewerId });
    }
  });
});

console.log(`Dago signaling server listening on ws://localhost:${PORT}`);

module.exports = { wss, rooms, MAX_VIEWERS_PER_ROOM };
