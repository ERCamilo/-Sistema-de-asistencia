(function (root) {
  'use strict';

  const DB_NAME = 'sa-mini-p2p-v1';
  const DB_VERSION = 1;
  const META_STORE = 'meta';
  const PEER_STORE = 'peers';
  const SIGNALING_URL = 'wss://p2p.erlin.do/ws';
  const TRANSFER_PROTOCOL = 'sa-mini-p2p-transfer/v1';
  const CONTROL_PROTOCOL = 'sa-mini-p2p-control/v1';
  const ROSTER_KIND = 'roster';
  const ROSTER_SCHEMA = 'sa-roster/v1';
  const LINK_TOKEN_BYTES = 32;
  const MAX_ROSTER_BYTES = 5 * 1024 * 1024;
  const CHUNK_SIZE = 12 * 1024;
  const MAX_SIGNAL_BYTES = 64 * 1024;
  const MAX_SDP_BYTES = 32 * 1024;
  const MAX_ICE_CANDIDATE_BYTES = 8 * 1024;
  const MAX_ICE_STRING_LENGTH = 256;
  const PAIR_SESSION_TTL_MS = 5 * 60 * 1000;
  const ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  const channelStates = new WeakMap();

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype;
  }

  function exactKeys(value, expected, message) {
    if (!isRecord(value)) throw new Error(message);
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
      throw new Error(message);
    }
  }

  function boundedString(value, maxBytes, message, { allowEmpty = false, allowControls = false } = {}) {
    if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) throw new Error(message);
    if (new TextEncoder().encode(value).byteLength > maxBytes) throw new Error(message);
    if (!allowControls && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(message);
    return value;
  }

  function channelState(channel) {
    if (!channel || (typeof channel !== 'object' && typeof channel !== 'function')) {
      throw new Error('Canal P2P inválido.');
    }
    let status = channelStates.get(channel);
    if (!status) {
      status = { authenticated: false, revoked: false, closing: false, closeSession: null };
      channelStates.set(channel, status);
    }
    return status;
  }

  function bindChannelSession(channel, closeSession) {
    channelState(channel).closeSession = typeof closeSession === 'function' ? closeSession : null;
  }

  function markChannelAuthenticated(channel) {
    const status = channelState(channel);
    if (status.revoked) throw new Error('Canal P2P revocado.');
    status.authenticated = true;
    return true;
  }

  function markChannelUnauthenticated(channel) {
    if (!channel) return;
    const status = channelState(channel);
    status.authenticated = false;
  }

  function revokeChannel(channel, reason) {
    if (!channel) return;
    const status = channelState(channel);
    status.authenticated = false;
    status.revoked = true;
    if (status.closing) return;
    status.closing = true;
    try {
      if (status.closeSession) status.closeSession();
      else channel.close?.();
    } catch (_) { /* close is best effort; the revoked bit is authoritative */ }
  }

  function isChannelAuthenticated(channel) {
    if (!channel) return false;
    const status = channelState(channel);
    return !status.revoked && status.authenticated && channel.readyState === 'open';
  }

  function pairSessionExpiry(now = Date.now()) {
    return (Math.floor(now / PAIR_SESSION_TTL_MS) + 1) * PAIR_SESSION_TTL_MS;
  }

  function assertPairSessionActive(expiresAt) {
    const now = Date.now();
    const expectedExpiry = pairSessionExpiry(now);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt !== expectedExpiry) {
      throw new Error('La sesión de emparejamiento expiró.');
    }
    return expiresAt;
  }

  function bytesToBase64Url(bytes) {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomToken(bytes = 32) {
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > 64) throw new Error('Tamaño de token inválido.');
    const out = new Uint8Array(bytes);
    crypto.getRandomValues(out);
    return bytesToBase64Url(out);
  }

  function validateBase64UrlBytes(value, byteLength, message = 'Token P2P inválido.') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(message);
    const expectedLength = Math.ceil(byteLength * 8 / 6);
    if (value.length !== expectedLength) throw new Error(message);
    let bytes;
    try { bytes = decodeBase64Url(value); } catch (_) { throw new Error(message); }
    if (bytes.byteLength !== byteLength || bytesToBase64Url(bytes) !== value) throw new Error(message);
    return value;
  }

  function validateLinkToken(value) {
    return validateBase64UrlBytes(value, LINK_TOKEN_BYTES, 'Token persistente inválido.');
  }

  function randomCode() {
    const data = new Uint32Array(1);
    crypto.getRandomValues(data);
    return String(100000 + (data[0] % 900000));
  }

  function randomPairKey() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const data = new Uint8Array(10);
    crypto.getRandomValues(data);
    const chars = Array.from(data, n => alphabet[n % alphabet.length]).join('');
    return chars.slice(0, 5) + '-' + chars.slice(5);
  }

  async function sha256Hex(value) {
    const bytes = value instanceof Uint8Array
      ? value
      : (ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : new TextEncoder().encode(String(value)));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function hmacHex(secret, value) {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(value)));
    return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
  }

  function normalizeCode(value) {
    const code = String(value || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) throw new Error('El código debe tener 6 dígitos.');
    return code;
  }

  function normalizePairKey(value) {
    const key = String(value || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
    if (!/^[A-Z2-9]{10}$/.test(key)) throw new Error('La clave debe tener 10 caracteres.');
    return key.slice(0, 5) + '-' + key.slice(5);
  }

  async function makePairDescriptor(self) {
    const code = randomCode();
    const key = randomPairKey();
    const expiresAt = pairSessionExpiry();
    const proof = await sha256Hex('pair:' + code + ':' + key.replace('-', '') + ':' + expiresAt);
    return {
      v: 1, code, key, room: 'pair-' + code, proof,
      issuerId: self.deviceId,
      issuerApp: self.appType,
      issuerName: self.displayName,
      expiresAt
    };
  }

  async function pairDescriptorFromManual(code, key, expiresAt = pairSessionExpiry()) {
    const normalizedCode = normalizeCode(code);
    const normalizedKey = normalizePairKey(key);
    assertPairSessionActive(expiresAt);
    return {
      v: 1,
      code: normalizedCode,
      key: normalizedKey,
      room: 'pair-' + normalizedCode,
      proof: await sha256Hex('pair:' + normalizedCode + ':' + normalizedKey.replace('-', '') + ':' + expiresAt),
      expiresAt
    };
  }

  function encodePairDescriptor(descriptor) {
    const bytes = new TextEncoder().encode(JSON.stringify({
      v: 1, code: descriptor.code, key: descriptor.key,
      issuerId: descriptor.issuerId ?? null, issuerApp: descriptor.issuerApp ?? null,
      issuerName: descriptor.issuerName ?? null, expiresAt: descriptor.expiresAt
    }));
    return bytesToBase64Url(bytes);
  }

  function decodeBase64Url(value) {
    if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
      throw new Error('Base64url inválido.');
    }
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const normalized = padded + '='.repeat((4 - padded.length % 4) % 4);
    const binary = atob(normalized);
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  }

  async function decodePairDescriptor(value) {
    let parsed;
    try { parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(value))); }
    catch (_) { throw new Error('QR de emparejamiento no compatible.'); }
    exactKeys(parsed, ['v', 'code', 'key', 'issuerId', 'issuerApp', 'issuerName', 'expiresAt'], 'QR de emparejamiento no compatible.');
    if (parsed.v !== 1 || !Number.isSafeInteger(parsed.expiresAt)) throw new Error('QR de emparejamiento no compatible.');
    const descriptor = await pairDescriptorFromManual(parsed.code, parsed.key, parsed.expiresAt);
    if (parsed.issuerId !== null) boundedString(parsed.issuerId, 128, 'Emisor del QR inválido.');
    if (parsed.issuerApp !== null && parsed.issuerApp !== 'sa') throw new Error('Emisor del QR inválido.');
    if (parsed.issuerName !== null) boundedString(parsed.issuerName, 80, 'Nombre del emisor inválido.');
    descriptor.issuerId = parsed.issuerId;
    descriptor.issuerApp = parsed.issuerApp;
    descriptor.issuerName = parsed.issuerName;
    return descriptor;
  }

  function buildPairUrl(descriptor, baseUrl) {
    const base = new URL(baseUrl || location.href);
    base.hash = 'p2p=' + encodePairDescriptor(descriptor);
    return base.toString();
  }

  function parsePairHash(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    const params = new URLSearchParams(raw);
    return params.get('p2p');
  }

  async function deriveTrustedRoute(linkToken) {
    validateLinkToken(linkToken);
    return {
      room: 'link-' + (await sha256Hex('room:' + linkToken)).slice(0, 48),
      proof: await sha256Hex('auth:' + linkToken)
    };
  }

  function validateSignalData(type, data) {
    if (type === 'offer' || type === 'answer') {
      exactKeys(data, ['type', 'sdp'], 'Forma SDP inválida.');
      if (data.type !== type) throw new Error('Tipo SDP inválido.');
      return { type, sdp: boundedString(data.sdp, MAX_SDP_BYTES, 'SDP inválido.') };
    }
    if (type === 'ice') {
      exactKeys(data, ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'], 'Forma ICE inválida.');
      const candidate = boundedString(data.candidate, MAX_ICE_CANDIDATE_BYTES, 'Candidate ICE inválido.');
      const sdpMid = data.sdpMid === null ? null : boundedString(data.sdpMid, MAX_ICE_STRING_LENGTH, 'sdpMid ICE inválido.');
      const usernameFragment = data.usernameFragment === null
        ? null
        : boundedString(data.usernameFragment, MAX_ICE_STRING_LENGTH, 'usernameFragment ICE inválido.');
      if (data.sdpMLineIndex !== null && (!Number.isInteger(data.sdpMLineIndex) || data.sdpMLineIndex < 0 || data.sdpMLineIndex > 255)) {
        throw new Error('sdpMLineIndex ICE inválido.');
      }
      return { candidate, sdpMid, sdpMLineIndex: data.sdpMLineIndex, usernameFragment };
    }
    throw new Error('Tipo de señalización inválido.');
  }

  function validateSignalFrameObject(frame) {
    exactKeys(frame, ['v', 'type', 'data'], 'Forma de señalización inválida.');
    if (frame.v !== 1 || !['offer', 'answer', 'ice'].includes(frame.type)) throw new Error('Señalización no compatible.');
    const normalized = { v: 1, type: frame.type, data: validateSignalData(frame.type, frame.data) };
    if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_SIGNAL_BYTES) throw new Error('Señal demasiado grande.');
    return normalized;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('IndexedDB no disponible.'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(PEER_STORE)) db.createObjectStore(PEER_STORE, { keyPath: 'peerId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('No se pudo abrir P2P IndexedDB.'));
    });
  }

  async function idbGet(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function idbPut(storeName, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = () => { const err = tx.error; db.close(); reject(err); };
    });
  }

  async function idbDelete(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const err = tx.error; db.close(); reject(err); };
    });
  }

  async function idbAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  function makeIdentityStore(appType, defaultName) {
    if (!['sa', 'mini'].includes(appType)) throw new Error('appType P2P inválido.');
    return {
      async getSelf() {
        let record = await idbGet(META_STORE, 'self');
        if (!record || record.appType !== appType) {
          record = {
            key: 'self',
            deviceId: crypto.randomUUID ? crypto.randomUUID() : randomToken(16),
            appType,
            displayName: defaultName || (appType === 'sa' ? 'SA' : 'Mini'),
            createdAt: new Date().toISOString()
          };
          await idbPut(META_STORE, record);
        }
        return record;
      },
      async renameSelf(displayName) {
        const self = await this.getSelf();
        self.displayName = String(displayName || '').trim().slice(0, 80) || self.displayName;
        return idbPut(META_STORE, self);
      },
      listPeers: () => idbAll(PEER_STORE),
      getPeer: peerId => idbGet(PEER_STORE, peerId),
      savePeer(peer) {
        if (!peer || !peer.peerId || !peer.linkToken) throw new Error('Peer P2P inválido.');
        const peerId = boundedString(String(peer.peerId).trim(), 128, 'Peer P2P inválido.');
        if (/[\s\u0000-\u001f\u007f]/.test(peerId)) throw new Error('Peer P2P inválido.');
        const expectedApp = appType === 'sa' ? 'mini' : 'sa';
        if (peer.peerApp !== expectedApp) throw new Error('La app remota P2P no es compatible.');
        const linkToken = validateLinkToken(peer.linkToken);
        return idbPut(PEER_STORE, {
          peerId,
          peerApp: expectedApp,
          displayName: String(peer.displayName || expectedApp || 'Dispositivo').slice(0, 80),
          linkToken,
          linkedAt: peer.linkedAt || new Date().toISOString(),
          lastSeenAt: peer.lastSeenAt || new Date().toISOString()
        });
      },
      removePeer: peerId => idbDelete(PEER_STORE, peerId)
    };
  }

  class SignalingClient {
    constructor({ url = SIGNALING_URL, room, peerId, proof, expiresAt = null }) {
      this.url = url;
      this.room = boundedString(String(room || '').trim(), 96, 'Sala P2P inválida.');
      this.peerId = boundedString(String(peerId || '').trim(), 128, 'Identidad P2P inválida.');
      if (/[\s\u0000-\u001f\u007f]/.test(this.peerId)) throw new Error('Identidad P2P inválida.');
      this.proof = String(proof || '').trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(this.proof)) throw new Error('Prueba P2P inválida.');
      this.expiresAt = expiresAt === null || expiresAt === undefined ? null : assertPairSessionActive(Number(expiresAt));
      if (this.room.startsWith('pair-') && this.expiresAt === null) throw new Error('La sesión de emparejamiento requiere expiración.');
      this.ws = null;
      this.listeners = new Set();
      this.closed = false;
    }
    onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(event) { for (const fn of this.listeners) { try { fn(event); } catch (_) {} } }
    connect() {
      if (this.expiresAt !== null) assertPairSessionActive(this.expiresAt);
      this.closed = false;
      if (this.ws && this.ws.readyState <= 1) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const url = new URL(this.url);
        url.searchParams.set('room', this.room);
        url.searchParams.set('peer', this.peerId);
        url.searchParams.set('proof', this.proof);
        if (this.expiresAt !== null) url.searchParams.set('expiresAt', String(this.expiresAt));
        const ws = new WebSocket(url.toString());
        this.ws = ws;
        ws.onopen = () => resolve();
        ws.onerror = () => {
          const error = new Error('No se pudo abrir la señalización P2P.');
          this.emit({ type: 'socket-error', error: error.message });
          reject(error);
        };
        ws.onmessage = event => {
          try { this.emit(JSON.parse(event.data)); } catch (_) { this.emit({ type: 'error', error: 'Señalización inválida.' }); }
        };
        ws.onclose = event => {
          this.closed = true;
          this.emit({ type: 'socket-closed', code: event.code, reason: event.reason });
        };
      });
    }
    send(type, data) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Señalización no conectada.');
      const frame = validateSignalFrameObject({ v: 1, type, data });
      this.ws.send(JSON.stringify(frame));
    }
    close() {
      this.closed = true;
      try { this.ws?.close(1000, 'done'); } catch (_) {}
    }
  }

  async function createRtcSession({ signaling, initiator, iceServers = ICE_SERVERS, onChannel, onState }) {
    const pc = new RTCPeerConnection({ iceServers });
    let channel = null;
    let offerSent = false;
    let closed = false;
    let offSignaling = null;
    let expiryTimer = null;
    const pendingIce = [];
    const flushIce = async () => {
      if (!pc.remoteDescription) return;
      while (pendingIce.length) await pc.addIceCandidate(pendingIce.shift());
    };
    const closeSession = () => {
      if (closed) return;
      closed = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      markChannelUnauthenticated(channel);
      try { offSignaling?.(); } catch (_) {}
      try { channel?.close?.(); } catch (_) {}
      try { pc.close(); } catch (_) {}
      try { signaling.close(); } catch (_) {}
    };
    const failClosed = error => {
      if (closed) return;
      const failure = error instanceof Error ? error : new Error(String(error || 'P2P session failed'));
      revokeChannel(channel, failure);
      if (!closed) closeSession();
      onState?.('error', failure);
    };
    const setChannel = ch => {
      if (!ch || channel) { failClosed(new Error('Canal P2P duplicado o inválido.')); return; }
      channel = ch;
      channelState(channel);
      bindChannelSession(channel, closeSession);
      channel.binaryType = 'arraybuffer';
      channel.onopen = () => { onState?.('connected'); onChannel?.(channel, pc); };
      channel.onclose = () => {
        markChannelUnauthenticated(channel);
        if (!closed) failClosed(new Error('El canal de datos P2P se cerró inesperadamente.'));
        onState?.('disconnected');
      };
      channel.onerror = () => failClosed(new Error('Canal de datos P2P falló.'));
    };
    if (initiator) setChannel(pc.createDataChannel('sa-mini-p2p', { ordered: true }));
    else pc.ondatachannel = event => setChannel(event.channel);

    pc.onicecandidate = event => {
      if (!event.candidate || closed) return;
      try {
        signaling.send('ice', event.candidate.toJSON ? event.candidate.toJSON() : event.candidate);
      } catch (error) { failClosed(error); }
    };
    pc.onconnectionstatechange = () => {
      if (closed) return;
      onState?.(pc.connectionState);
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        failClosed(new Error('La conexión P2P dejó de estar disponible.'));
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (closed) return;
      const iceState = pc.iceConnectionState;
      if (['failed', 'closed', 'disconnected'].includes(iceState)) {
        failClosed(new Error('La conexión ICE P2P dejó de estar disponible.'));
      }
    };

    const makeOffer = async () => {
      if (!initiator || offerSent || closed) return;
      offerSent = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signaling.send('offer', { type: offer.type, sdp: offer.sdp });
    };

    offSignaling = signaling.onEvent(async event => {
      try {
        if (closed) return;
        if (event?.type === 'peer-left' || event?.type === 'socket-closed' || event?.type === 'socket-error' || event?.type === 'error') {
          throw new Error(event.error || event.reason || 'La señalización P2P se cerró.');
        }
        if (event.type === 'peer-joined' || (event.type === 'ready' && Number(event.peerCount) >= 2)) {
          await makeOffer();
        }
        if (event.type !== 'signal' || !event.frame) return;
        const { type, data } = validateSignalFrameObject(event.frame);
        if (type === 'offer' && !initiator) {
          await pc.setRemoteDescription(data);
          await flushIce();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signaling.send('answer', { type: answer.type, sdp: answer.sdp });
        } else if (type === 'answer' && initiator) {
          await pc.setRemoteDescription(data);
          await flushIce();
        } else if (type === 'ice' && data) {
          if (pc.remoteDescription) await pc.addIceCandidate(data);
          else pendingIce.push(data);
        }
      } catch (error) {
        failClosed(error);
      }
    });
    try {
      await signaling.connect();
      if (signaling.expiresAt !== null) {
        const delay = Math.max(0, signaling.expiresAt - Date.now());
        expiryTimer = setTimeout(() => failClosed(new Error('La sesión de emparejamiento expiró.')), delay);
      }
    } catch (error) {
      failClosed(error);
      throw error;
    }
    return { pc, get channel() { return channel; }, close: closeSession, isClosed: () => closed };
  }

  function waitForBufferedAmount(channel, low = 128 * 1024) {
    if (channel.bufferedAmount <= low) return Promise.resolve();
    return new Promise(resolve => {
      channel.bufferedAmountLowThreshold = low;
      const handler = () => { channel.removeEventListener('bufferedamountlow', handler); resolve(); };
      channel.addEventListener('bufferedamountlow', handler);
    });
  }

  function expectedTotalChunks(size) {
    return size === 0 ? 0 : Math.ceil(size / CHUNK_SIZE);
  }

  function validateTransferId(value) {
    return boundedString(value, 128, 'ID de transferencia inválido.');
  }

  function validateSha256(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('SHA-256 inválido.');
    return value.toLowerCase();
  }

  function validateTransferStart(message) {
    exactKeys(message, ['protocol', 'type', 'transferId', 'kind', 'schema', 'size', 'chunkSize', 'totalChunks', 'sha256'], 'Inicio de transferencia inválido.');
    if (message.protocol !== TRANSFER_PROTOCOL || message.type !== 'start') throw new Error('Inicio de transferencia inválido.');
    if (message.kind !== ROSTER_KIND || message.schema !== ROSTER_SCHEMA) throw new Error('Sólo se admite roster sa-roster/v1.');
    if (!Number.isSafeInteger(message.size) || message.size < 0 || message.size > MAX_ROSTER_BYTES) throw new Error('Tamaño de transferencia inválido.');
    if (message.chunkSize !== CHUNK_SIZE) throw new Error('Tamaño de chunk no compatible.');
    if (!Number.isSafeInteger(message.totalChunks) || message.totalChunks !== expectedTotalChunks(message.size)) throw new Error('Cantidad de chunks inválida.');
    return {
      ...message,
      transferId: validateTransferId(message.transferId),
      sha256: validateSha256(message.sha256)
    };
  }

  function validateTransferEnd(message, transferId) {
    exactKeys(message, ['protocol', 'type', 'transferId'], 'Fin de transferencia inválido.');
    if (message.protocol !== TRANSFER_PROTOCOL || message.type !== 'end' || message.transferId !== transferId) {
      throw new Error('Fin de transferencia inesperado.');
    }
    return message;
  }

  function expectedChunkPayloadLength(size, totalChunks, index) {
    if (totalChunks === 0 || index >= totalChunks) return -1;
    return index === totalChunks - 1
      ? size - (CHUNK_SIZE * (totalChunks - 1))
      : CHUNK_SIZE;
  }

  async function sendAuthenticated(channel, frame) {
    if (!isChannelAuthenticated(channel)) throw new Error('Canal P2P no autenticado.');
    try { channel.send(frame); }
    catch (error) { revokeChannel(channel, error); throw error; }
  }

  async function sendPayload(channel, { kind, schema, text, onProgress }) {
    if (!isChannelAuthenticated(channel)) throw new Error('Canal P2P no autenticado.');
    if (kind !== ROSTER_KIND || schema !== ROSTER_SCHEMA) throw new Error('Sólo se admite roster sa-roster/v1.');
    if (typeof text !== 'string') throw new Error('El roster debe ser texto UTF-8.');
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > MAX_ROSTER_BYTES) throw new Error('El roster excede el límite permitido.');
    const transferId = crypto.randomUUID ? crypto.randomUUID() : randomToken(16);
    const digest = await sha256Hex(bytes);
    const totalChunks = expectedTotalChunks(bytes.byteLength);
    const start = validateTransferStart({ protocol: TRANSFER_PROTOCOL, type: 'start', transferId, kind, schema, size: bytes.byteLength, chunkSize: CHUNK_SIZE, totalChunks, sha256: digest });
    await sendAuthenticated(channel, JSON.stringify(start));
    for (let index = 0; index < totalChunks; index++) {
      await waitForBufferedAmount(channel);
      const start = index * CHUNK_SIZE;
      const end = Math.min(bytes.byteLength, start + CHUNK_SIZE);
      const chunk = bytes.slice(start, end);
      const frame = new Uint8Array(4 + chunk.byteLength);
      new DataView(frame.buffer).setUint32(0, index);
      frame.set(chunk, 4);
      await sendAuthenticated(channel, frame.buffer);
      onProgress?.((index + 1) / totalChunks);
    }
    await sendAuthenticated(channel, JSON.stringify({ protocol: TRANSFER_PROTOCOL, type: 'end', transferId }));
    return { transferId, size: bytes.byteLength, sha256: digest, kind: ROSTER_KIND, schema: ROSTER_SCHEMA, totalChunks };
  }

  function createTransferReceiver({ channel, onComplete, onProgress, onError } = {}) {
    let current = null;
    let failed = false;
    const fail = error => {
      if (failed) return;
      current = null;
      failed = true;
      const failure = error instanceof Error ? error : new Error(String(error));
      if (channel) revokeChannel(channel, failure);
      onError?.(failure);
    };
    const assertAuthenticated = () => {
      if (!channel || !isChannelAuthenticated(channel)) {
        const error = new Error('Canal P2P no autenticado.');
        fail(error);
        throw error;
      }
    };
    return async function handleMessage(event) {
      try {
        if (failed) return false;
        assertAuthenticated();
        if (typeof event.data === 'string') {
           const msg = JSON.parse(event.data);
           if (!msg || msg.protocol !== TRANSFER_PROTOCOL) return false;
           if (msg.type === 'start') {
             if (current) throw new Error('Ya hay una transferencia en curso.');
             const meta = validateTransferStart(msg);
             current = { meta, chunks: new Array(meta.totalChunks), received: 0, receivedBytes: 0 };
             return true;
           }
           if (msg.type === 'end') {
             if (!current) throw new Error('Fin de transferencia inesperado.');
             validateTransferEnd(msg, current.meta.transferId);
             if (current.received !== current.meta.totalChunks) throw new Error('Faltan chunks de la transferencia.');
             if (current.receivedBytes !== current.meta.size) throw new Error('Tamaño recibido no coincide.');
             const bytes = new Uint8Array(current.meta.size);
             let offset = 0;
             for (const chunk of current.chunks) { if (!chunk) throw new Error('Chunk faltante.'); bytes.set(chunk, offset); offset += chunk.byteLength; }
             if (offset !== current.meta.size) throw new Error('Tamaño recibido no coincide.');
             const digest = await sha256Hex(bytes);
             if (digest !== current.meta.sha256) throw new Error('SHA-256 no coincide.');
              let text;
              try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
              } catch (_) {
                throw new Error('El roster no contiene UTF-8 válido.');
              }
              assertAuthenticated();
              const result = { ...current.meta, bytes, text };
              current = null;
              await onComplete?.(result);
              return true;
           }
           throw new Error('Framing de transferencia desconocido.');
         }
         if (!current) throw new Error('Chunk binario sin transferencia activa.');
         const raw = event.data instanceof ArrayBuffer
           ? new Uint8Array(event.data)
           : (ArrayBuffer.isView(event.data)
               ? new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
               : new Uint8Array(await event.data.arrayBuffer()));
         if (raw.byteLength < 4) throw new Error('Chunk inválido.');
         const index = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0);
         if (index >= current.meta.totalChunks) throw new Error('Índice de chunk fuera de rango.');
         if (current.chunks[index]) throw new Error('Chunk duplicado.');
         const payloadLength = expectedChunkPayloadLength(current.meta.size, current.meta.totalChunks, index);
         if (raw.byteLength !== 4 + payloadLength) throw new Error('Longitud de chunk inválida.');
         if (current.receivedBytes + payloadLength > current.meta.size || current.receivedBytes + payloadLength > MAX_ROSTER_BYTES) throw new Error('Tamaño agregado inválido.');
         current.chunks[index] = raw.slice(4);
         current.received += 1;
         current.receivedBytes += payloadLength;
         onProgress?.(current.received / current.meta.totalChunks);
         return true;
      } catch (error) { fail(error); return true; }
    };
  }

  function validateDeviceId(value, message = 'Identidad P2P inválida.') {
    const id = boundedString(value, 128, message);
    if (/[\s\u0000-\u001f\u007f]/.test(id)) throw new Error(message);
    return id;
  }

  function validateSessionId(value, message = 'Sesión P2P inválida.') {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(message);
    return value.toLowerCase();
  }

  function validateMac(value, message = 'MAC P2P inválido.') {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(message);
    return value.toLowerCase();
  }

  function validateControlData(type, data) {
    if (type === 'pair-hello') {
      exactKeys(data, ['deviceId', 'appType', 'displayName', 'nonce'], 'Identidad P2P inválida.');
      if (!['sa', 'mini'].includes(data.appType)) throw new Error('Tipo de app P2P inválido.');
      return {
        deviceId: validateDeviceId(data.deviceId),
        appType: data.appType,
        displayName: boundedString(data.displayName, 80, 'Nombre P2P inválido.'),
        nonce: validateBase64UrlBytes(data.nonce, 16, 'Nonce P2P inválido.')
      };
    }
    if (type === 'pair-accept') {
      exactKeys(data, ['deviceId', 'sessionId'], 'Confirmación P2P inválida.');
      return { deviceId: validateDeviceId(data.deviceId), sessionId: validateSessionId(data.sessionId) };
    }
    if (type === 'pair-reject') {
      exactKeys(data, ['deviceId'], 'Confirmación P2P inválida.');
      return { deviceId: validateDeviceId(data.deviceId) };
    }
    if (type === 'pair-link' || type === 'pair-linked') {
      exactKeys(data, ['linkToken', 'sessionId', 'initiatorId', 'receiverId', 'mac'], 'Enlace P2P inválido.');
      return {
        linkToken: validateLinkToken(data.linkToken),
        sessionId: validateSessionId(data.sessionId),
        initiatorId: validateDeviceId(data.initiatorId),
        receiverId: validateDeviceId(data.receiverId),
        mac: validateMac(data.mac)
      };
    }
    if (type === 'trusted-hello' || type === 'trusted-ok') {
      exactKeys(data, ['deviceId', 'peerId', 'nonce', 'mac'], 'Prueba de confianza P2P inválida.');
      return {
        deviceId: validateDeviceId(data.deviceId),
        peerId: validateDeviceId(data.peerId),
        nonce: validateBase64UrlBytes(data.nonce, 16, 'Nonce P2P inválido.'),
        mac: validateMac(data.mac)
      };
    }
    if (type === 'roster-staged') {
      exactKeys(data, ['transferId', 'sha256', 'kind', 'schema', 'validated'], 'ACK de roster inválido.');
      if (data.kind !== ROSTER_KIND || data.schema !== ROSTER_SCHEMA || data.validated !== true) throw new Error('ACK de roster inválido.');
      return { transferId: validateTransferId(data.transferId), sha256: validateSha256(data.sha256), kind: ROSTER_KIND, schema: ROSTER_SCHEMA, validated: true };
    }
    if (type === 'roster-rejected') {
      exactKeys(data, ['transferId', 'reason', 'kind', 'schema', 'validated'], 'Rechazo de roster inválido.');
      if (data.kind !== ROSTER_KIND || data.schema !== ROSTER_SCHEMA || data.validated !== false) throw new Error('Rechazo de roster inválido.');
      return {
        transferId: validateTransferId(data.transferId),
        reason: boundedString(data.reason, 256, 'Rechazo de roster inválido.'),
        kind: ROSTER_KIND,
        schema: ROSTER_SCHEMA,
        validated: false
      };
    }
    throw new Error('Tipo de control P2P desconocido.');
  }

  function validateControlFrame(frame) {
    exactKeys(frame, ['protocol', 'type', 'data'], 'Frame de control P2P inválido.');
    if (frame.protocol !== CONTROL_PROTOCOL) throw new Error('Protocolo de control P2P inválido.');
    return { protocol: CONTROL_PROTOCOL, type: frame.type, data: validateControlData(frame.type, frame.data) };
  }

  function sendControl(channel, type, data) {
    if (!channel || channel.readyState !== 'open') throw new Error('Canal P2P no conectado.');
    let frame;
    try { frame = validateControlFrame({ protocol: CONTROL_PROTOCOL, type, data }); }
    catch (error) { revokeChannel(channel, error); throw error; }
    try { channel.send(JSON.stringify(frame)); }
    catch (error) { revokeChannel(channel, error); throw error; }
  }

  function parseControl(data) {
    if (typeof data !== 'string') return null;
    let parsed;
    try { parsed = JSON.parse(data); } catch (_) { return null; }
    if (!parsed || parsed.protocol !== CONTROL_PROTOCOL) return null;
    return validateControlFrame(parsed);
  }

  async function makePairSessionId(descriptorProof, initiatorId, receiverId, initiatorNonce, receiverNonce) {
    const proof = validateMac(descriptorProof, 'Prueba de emparejamiento inválida.');
    const initiator = validateDeviceId(initiatorId);
    const receiver = validateDeviceId(receiverId);
    const firstNonce = validateBase64UrlBytes(initiatorNonce, 16, 'Nonce P2P inválido.');
    const secondNonce = validateBase64UrlBytes(receiverNonce, 16, 'Nonce P2P inválido.');
    return sha256Hex('pair-session:v1:' + proof + ':' + initiator + ':' + receiver + ':' + firstNonce + ':' + secondNonce);
  }

  async function makePairLinkMac(kind, descriptorProof, sessionId, initiatorId, receiverId, linkToken) {
    if (kind !== 'pair-link' && kind !== 'pair-linked') throw new Error('Tipo de enlace P2P inválido.');
    validateLinkToken(linkToken);
    const proof = validateMac(descriptorProof, 'Prueba de emparejamiento inválida.');
    const session = validateSessionId(sessionId);
    const initiator = validateDeviceId(initiatorId);
    const receiver = validateDeviceId(receiverId);
    const token = validateLinkToken(linkToken);
    return hmacHex(proof, kind + ':v1:' + session + ':' + initiator + ':' + receiver + ':' + token);
  }

  function validateRosterStageAck(data, expectedTransfer) {
    const ack = validateControlData('roster-staged', data);
    if (!expectedTransfer || ack.transferId !== expectedTransfer.transferId || ack.sha256 !== String(expectedTransfer.sha256 || '').toLowerCase()) {
      throw new Error('El ACK de Mini no coincide con la transferencia.');
    }
    return ack;
  }

  function validateRosterRejected(data, expectedTransfer) {
    const rejection = validateControlData('roster-rejected', data);
    if (!expectedTransfer || rejection.transferId !== expectedTransfer.transferId) {
      throw new Error('El rechazo de Mini no coincide con la transferencia.');
    }
    return rejection;
  }

  async function makeSas(nonceA, nonceB, context) {
    const parts = [String(nonceA), String(nonceB)].sort();
    const hex = await sha256Hex(parts.join(':') + ':' + String(context || ''));
    const value = parseInt(hex.slice(0, 10), 16) % 1000000;
    return String(value).padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2');
  }

  const api = {
    DB_NAME, SIGNALING_URL, TRANSFER_PROTOCOL, CONTROL_PROTOCOL, ROSTER_KIND, ROSTER_SCHEMA,
    LINK_TOKEN_BYTES,
    MAX_ROSTER_BYTES, CHUNK_SIZE, MAX_SIGNAL_BYTES, MAX_SDP_BYTES, MAX_ICE_CANDIDATE_BYTES,
    PAIR_SESSION_TTL_MS, ICE_SERVERS,
    randomToken, randomCode, randomPairKey, sha256Hex, hmacHex,
    validateLinkToken, validateDeviceId, pairSessionExpiry, assertPairSessionActive,
    normalizeCode, normalizePairKey, makePairDescriptor, pairDescriptorFromManual,
    encodePairDescriptor, decodePairDescriptor, buildPairUrl, parsePairHash, deriveTrustedRoute,
    makeIdentityStore, SignalingClient, createRtcSession, sendPayload, createTransferReceiver,
    validateSignalData, validateSignalFrameObject, validateTransferStart, validateTransferEnd,
    validateControlFrame, sendControl, parseControl, makePairSessionId, makePairLinkMac,
    validateRosterStageAck, validateRosterRejected,
    markChannelAuthenticated, markChannelUnauthenticated, revokeChannel, isChannelAuthenticated,
    bindChannelSession, makeSas
  };
  root.SaMiniP2P = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
