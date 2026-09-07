import {
  normalizePairExpiry,
  normalizePeer,
  normalizeProof,
  normalizeRoom,
  validateSignalFrame
} from './protocol.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'sa-mini-p2p-signaling', version: 1 });
    if (url.pathname !== '/ws') return json({ error: 'not found' }, 404);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'websocket required' }, 426);
    try {
      const room = normalizeRoom(url.searchParams.get('room'));
      const id = env.ROOMS.idFromName(room);
      return env.ROOMS.get(id).fetch(request);
    } catch (error) {
      return json({ error: error.message || 'invalid request' }, 400);
    }
  }
};

export class SignalingRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const room = normalizeRoom(url.searchParams.get('room'));
      const peer = normalizePeer(url.searchParams.get('peer'));
      const proof = normalizeProof(url.searchParams.get('proof'));
      const expiresAt = room.startsWith('pair-')
        ? normalizePairExpiry(url.searchParams.get('expiresAt'))
        : null;
      const sockets = this.pruneExpiredSockets();
      const existing = sockets.map(ws => ws.deserializeAttachment?.()).filter(Boolean);
      if (existing.some(meta => meta.peer === peer)) return json({ error: 'peer already connected' }, 409);
      if (sockets.length >= 2) return json({ error: 'room full' }, 409);
      if (existing.length && (existing[0].proof !== proof || existing[0].expiresAt !== expiresAt)) {
        return json({ error: 'pair proof mismatch' }, 403);
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ peer, proof, expiresAt, connectedAt: Date.now() });
      this.broadcast({ v: 1, type: 'peer-joined', peer }, server);
      server.send(JSON.stringify({ v: 1, type: 'ready', peerCount: sockets.length + 1 }));
      return new Response(null, { status: 101, webSocket: client });
    } catch (error) {
      return json({ error: error.message || 'invalid websocket request' }, 400);
    }
  }

  webSocketMessage(ws, message) {
    try {
      const meta = ws.deserializeAttachment?.();
      if (!meta || (meta.expiresAt && Date.now() >= meta.expiresAt)) {
        this.closeInvalid(ws, 'pair session expired');
        return;
      }
      const frame = validateSignalFrame(message);
      const sender = meta.peer;
      this.broadcast({ v: 1, type: 'signal', from: sender, frame }, ws);
    } catch (error) {
      this.closeInvalid(ws, error.message || 'invalid signal');
    }
  }

  webSocketClose(ws, code, reason) {
    const peer = ws.deserializeAttachment?.()?.peer || 'unknown';
    this.broadcast({ v: 1, type: 'peer-left', peer, code, reason: String(reason || '').slice(0, 120) }, ws);
  }

  webSocketError(ws) {
    const peer = ws.deserializeAttachment?.()?.peer || 'unknown';
    this.broadcast({ v: 1, type: 'peer-left', peer, code: 1011, reason: 'websocket error' }, ws);
  }

  pruneExpiredSockets() {
    const sockets = this.state.getWebSockets();
    const active = [];
    for (const socket of sockets) {
      const meta = socket.deserializeAttachment?.();
      if (meta?.expiresAt && Date.now() >= meta.expiresAt) {
        this.closeInvalid(socket, 'pair session expired');
      } else {
        active.push(socket);
      }
    }
    return active;
  }

  closeInvalid(ws, reason) {
    try { ws.close(1008, String(reason || 'invalid signaling').slice(0, 120)); } catch (_) {}
  }

  broadcast(payload, exclude) {
    const text = JSON.stringify(payload);
    for (const socket of this.state.getWebSockets()) {
      if (socket !== exclude) {
        try { socket.send(text); } catch (_) { /* peer already closed */ }
      }
    }
  }
}
