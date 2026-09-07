export const SIGNAL_PROTOCOL = 'sa-mini-p2p-signaling/v1';
export const MAX_SIGNAL_BYTES = 64 * 1024;
export const MAX_SDP_BYTES = 32 * 1024;
export const MAX_ICE_CANDIDATE_BYTES = 8 * 1024;
export const MAX_ICE_MID_LENGTH = 256;
export const MAX_ICE_USERNAME_LENGTH = 256;
export const MAX_ROOM_LENGTH = 96;
export const MAX_PEER_LENGTH = 128;
export const ALLOWED_SIGNAL_TYPES = new Set(['offer', 'answer', 'ice']);
export const PAIR_SESSION_TTL_MS = 5 * 60 * 1000;

const SAFE_TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const HEX_64_RE = /^[a-f0-9]{64}$/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function requireExactKeys(value, expected, message) {
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
  if (!allowControls && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(message);
  }
  return value;
}

function validateSdp(type, data) {
  requireExactKeys(data, ['type', 'sdp'], 'invalid SDP shape');
  if (data.type !== type) throw new Error('SDP type mismatch');
  return {
    type,
    sdp: boundedString(data.sdp, MAX_SDP_BYTES, 'invalid SDP')
  };
}

function validateIce(data) {
  requireExactKeys(data, ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'], 'invalid ICE shape');
  const candidate = boundedString(data.candidate, MAX_ICE_CANDIDATE_BYTES, 'invalid ICE candidate');
  const sdpMid = data.sdpMid === null
    ? null
    : boundedString(data.sdpMid, MAX_ICE_MID_LENGTH, 'invalid ICE sdpMid');
  const usernameFragment = data.usernameFragment === null
    ? null
    : boundedString(data.usernameFragment, MAX_ICE_USERNAME_LENGTH, 'invalid ICE usernameFragment');
  if (data.sdpMLineIndex !== null && (!Number.isInteger(data.sdpMLineIndex) || data.sdpMLineIndex < 0 || data.sdpMLineIndex > 255)) {
    throw new Error('invalid ICE sdpMLineIndex');
  }
  return { candidate, sdpMid, sdpMLineIndex: data.sdpMLineIndex, usernameFragment };
}

export function normalizeRoom(value) {
  const room = String(value || '').trim();
  if (!room || room.length > MAX_ROOM_LENGTH || !SAFE_TOKEN_RE.test(room)) {
    throw new Error('invalid room');
  }
  return room;
}

export function normalizePeer(value) {
  const peer = String(value || '').trim();
  if (!peer || peer.length > MAX_PEER_LENGTH || /[\s\u0000-\u001f\u007f]/.test(peer)) {
    throw new Error('invalid peer');
  }
  return peer;
}

export function normalizeProof(value) {
  const proof = String(value || '').trim().toLowerCase();
  if (!HEX_64_RE.test(proof)) throw new Error('invalid proof');
  return proof;
}

export function normalizePairExpiry(value, now = Date.now()) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new Error('invalid pair expiry');
  const expiresAt = Number(raw);
  const expectedExpiry = (Math.floor(now / PAIR_SESSION_TTL_MS) + 1) * PAIR_SESSION_TTL_MS;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt !== expectedExpiry) {
    throw new Error('pair session expired');
  }
  return expiresAt;
}

export function validateSignalFrame(raw) {
  if (typeof raw !== 'string') throw new Error('signal must be text');
  if (new TextEncoder().encode(raw).byteLength > MAX_SIGNAL_BYTES) throw new Error('signal too large');
  const frame = JSON.parse(raw);
  requireExactKeys(frame, ['v', 'type', 'data'], 'invalid signal shape');
  if (frame.v !== 1 || !ALLOWED_SIGNAL_TYPES.has(frame.type)) throw new Error('unsupported signal');
  const data = frame.type === 'ice'
    ? validateIce(frame.data)
    : validateSdp(frame.type, frame.data);
  return { v: 1, type: frame.type, data };
}
