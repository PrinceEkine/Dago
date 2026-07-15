'use strict';

/**
 * Minimal WebRTC signaling relay for Dago's in-app screensharing feature.
 *
 * This server never sees screen content - it only relays SDP offers/answers
 * and ICE candidates between exactly two peers (a "host" sharing their
 * screen and a "viewer" watching it) so they can establish a direct
 * peer-to-peer WebRTC connection. Rooms are ephemeral, in-memory, and
 * identified by a short code; nothing is persisted to disk.
 *
 * Run with: node signaling-server/server.js
 * Configure the port with the PORT env var (default 8089).
 */

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8089;
const rooms = new Map(); // code -> { host: ws|null, viewer: ws|null }

const wss = new WebSocketServer({ port: PORT });

function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function otherPeer(room, ws) {
  if (!room) return null;
  return room.host === ws ? room.viewer : room.host;
}

wss.on('connection', (ws) => {
  ws.room = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }

    if (msg.type === 'host') {
      const code = msg.room;
      if (!rooms.has(code)) rooms.set(code, { host: null, viewer: null });
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
      room.viewer = ws;
      ws.room = code;
      ws.role = 'viewer';
      send(room.host, { type: 'viewer-joined' });
      return;
    }

    // Relay offer / answer / ice-candidate to the other peer in the room.
    if (['offer', 'answer', 'ice-candidate'].includes(msg.type)) {
      const room = rooms.get(ws.room);
      const peer = otherPeer(room, ws);
      send(peer, msg);
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    const peer = otherPeer(room, ws);
    send(peer, { type: 'peer-left' });
    if (room.host === ws) room.host = null;
    if (room.viewer === ws) room.viewer = null;
    if (!room.host && !room.viewer) rooms.delete(ws.room);
  });
});

console.log(`Dago signaling server listening on ws://localhost:${PORT}`);
