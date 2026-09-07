import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAX_ICE_CANDIDATE_BYTES,
  MAX_SDP_BYTES,
  normalizePairExpiry,
  normalizePeer,
  normalizeProof,
  normalizeRoom,
  validateSignalFrame
} from '../src/protocol.js';

test('room/peer/proof validation is fail-closed', () => {
  assert.equal(normalizeRoom('abc_123-X'), 'abc_123-X');
  assert.equal(normalizePeer('mini-device-1'), 'mini-device-1');
  assert.equal(normalizeProof('a'.repeat(64)), 'a'.repeat(64));
  assert.throws(() => normalizeRoom('../bad'));
  assert.throws(() => normalizePeer('bad peer'));
  assert.throws(() => normalizeProof('1234'));
});

test('signaling validates exact offer/answer/ICE WebRTC shapes', () => {
  const ok = validateSignalFrame(JSON.stringify({ v: 1, type: 'offer', data: { type: 'offer', sdp: 'v=0\r\n' } }));
  assert.equal(ok.type, 'offer');
  assert.deepEqual(ok.data, { type: 'offer', sdp: 'v=0\r\n' });
  assert.deepEqual(validateSignalFrame(JSON.stringify({
    v: 1,
    type: 'ice',
    data: { candidate: 'candidate:1 1 UDP 1 192.0.2.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'ufrag' }
  })).data, {
    candidate: 'candidate:1 1 UDP 1 192.0.2.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'ufrag'
  });
  assert.throws(() => validateSignalFrame(JSON.stringify({ v: 1, type: 'payload', data: 'roster' })));
  assert.throws(() => validateSignalFrame(JSON.stringify({ v: 1, type: 'offer', data: {}, extra: true })));
  assert.throws(() => validateSignalFrame(JSON.stringify({ v: 1, type: 'offer', data: { type: 'offer', sdp: { roster: 'bytes' } } })));
  assert.throws(() => validateSignalFrame(JSON.stringify({ v: 1, type: 'offer', data: { type: 'answer', sdp: 'v=0' } })));
  assert.throws(() => validateSignalFrame(JSON.stringify({ v: 1, type: 'ice', data: { candidate: 'x', sdpMid: null, sdpMLineIndex: 0, usernameFragment: null, payload: 'roster' } })));
  assert.throws(() => validateSignalFrame(JSON.stringify({ v: 1, type: 'ice', data: { candidate: 'x', sdpMid: null, sdpMLineIndex: '0', usernameFragment: null } })));
  assert.throws(() => validateSignalFrame(JSON.stringify({ v: 1, type: 'offer', data: { type: 'offer', sdp: 'x'.repeat(MAX_SDP_BYTES + 1) } })));
  assert.throws(() => validateSignalFrame(JSON.stringify({ v: 1, type: 'ice', data: { candidate: 'x'.repeat(MAX_ICE_CANDIDATE_BYTES + 1), sdpMid: null, sdpMLineIndex: 0, usernameFragment: null } })));
});

test('manual and QR pairing sessions have a bounded server-checkable expiry', () => {
  const now = 1_000_000;
  const expiry = (Math.floor(now / (5 * 60 * 1000)) + 1) * (5 * 60 * 1000);
  assert.equal(normalizePairExpiry(String(expiry), now), expiry);
  assert.throws(() => normalizePairExpiry(String(now), now));
  assert.throws(() => normalizePairExpiry(String(expiry + 1), now));
});

test('worker never writes Durable Object storage or logs payloads', () => {
  const src = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.equal(/storage\.(put|get|delete|sql)/.test(src), false);
  assert.equal(/console\.(log|info|debug)/.test(src), false);
  assert.equal(src.includes("type: 'payload'"), false);
});
