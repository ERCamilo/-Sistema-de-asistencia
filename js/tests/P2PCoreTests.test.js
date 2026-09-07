const { webcrypto } = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');
globalThis.TextEncoder = TextEncoder; globalThis.TextDecoder = TextDecoder;
window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
const Core = require('../p2p/P2PCore.js');
const Pairing = require('../p2p/P2PPairing.js');

function tick() { return new Promise(resolve => setTimeout(resolve, 0)); }
async function waitFor(predicate, label, attempts = 50) {
  for (let i = 0; i < attempts; i++) { if (predicate()) return; await tick(); }
  throw new Error('timeout waiting for ' + label);
}
class CaptureChannel {
  constructor() { this.readyState = 'open'; this.bufferedAmount = 0; this.frames = []; this.closed = false; this.closeCalls = 0; }
  send(frame) { this.frames.push(frame); }
  addEventListener() {}
  removeEventListener() {}
  close() { this.closeCalls += 1; this.closed = true; this.readyState = 'closed'; this.onclose?.(); }
}
function authenticatedChannel() { const channel = new CaptureChannel(); Core.markChannelAuthenticated(channel); return channel; }
class LinkedChannel {
  constructor() { this.readyState = 'open'; this.bufferedAmount = 0; this.listeners = new Set(); this.peer = null; this.transform = null; this.closed = false; }
  addEventListener(type, fn) { if (type === 'message') this.listeners.add(fn); }
  removeEventListener(type, fn) { if (type === 'message') this.listeners.delete(fn); }
  send(data) {
    if (!this.peer || this.peer.listeners.size === 0) return;
    const peer = this.peer;
    const outgoing = this.transform ? this.transform(data) : data;
    queueMicrotask(() => { for (const fn of [...peer.listeners]) fn({ data: outgoing }); });
  }
  close() { this.closed = true; this.readyState = 'closed'; }
}
function linkedPair() { const a = new LinkedChannel(); const b = new LinkedChannel(); a.peer=b; b.peer=a; return [a,b]; }
class ControlledLinkedChannel {
  constructor() { this.readyState = 'open'; this.bufferedAmount = 0; this.listeners = new Set(); this.peer = null; this.pending = []; this.closed = false; }
  addEventListener(type, fn) { if (type === 'message') this.listeners.add(fn); }
  removeEventListener(type, fn) { if (type === 'message') this.listeners.delete(fn); }
  send(data) { this.peer.pending.push(data); }
  async deliverNext() {
    const data = this.pending.shift();
    if (data === undefined) return false;
    await Promise.all([...this.listeners].map(fn => fn({ data })));
    return true;
  }
  close() { this.closed = true; this.readyState = 'closed'; }
}
function controlledLinkedPair() { const a = new ControlledLinkedChannel(); const b = new ControlledLinkedChannel(); a.peer=b; b.peer=a; return [a,b]; }
function makeStore() { const saved=[]; return { saved, async savePeer(peer){ saved.push({...peer}); return {...peer}; } }; }
async function deliver(frames, receiver, mutate=x=>x) {
  for (let i=0;i<frames.length;i++) { const frame=mutate(frames[i],i,frames); if(frame!==undefined) await receiver({data:frame}); }
}

class FakeSignaling {
  constructor() { this.listeners = new Set(); this.expiresAt = null; this.closed = false; this.closeCalls = 0; this.send = () => {}; }
  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async connect() {}
  emit(event) { for (const fn of [...this.listeners]) fn(event); }
  close() { this.closeCalls += 1; this.closed = true; }
}

class FakePeerConnection {
  constructor() { this.connectionState = 'new'; this.iceConnectionState = 'new'; this.remoteDescription = null; this.closed = false; this.closeCalls = 0; }
  createDataChannel() { return new CaptureChannel(); }
  async createOffer() { return { type:'offer', sdp:'v=0\r\n' }; }
  async createAnswer() { return { type:'answer', sdp:'v=0\r\n' }; }
  async setLocalDescription(value) { this.localDescription = value; }
  async setRemoteDescription(value) { this.remoteDescription = value; }
  async addIceCandidate(value) { this.ice = value; }
  close() { this.closeCalls += 1; this.closed = true; }
}

test('P2P roster transfer round-trips chunks and verifies SHA-256', async () => {
  const channel=new CaptureChannel();
  Core.markChannelAuthenticated(channel);
  const text=JSON.stringify({schema:'sa-roster/v1',employees:[{name:'A'.repeat(Core.CHUNK_SIZE*2)}]});
  const sent=await Core.sendPayload(channel,{kind:'roster',schema:'sa-roster/v1',text});
  let result=null,error=null;
  const receiver=Core.createTransferReceiver({channel, onComplete:r=>{result=r;},onError:e=>{error=e;}});
  await deliver(channel.frames,receiver);
  expect(error).toBeNull();
  expect(result.text).toBe(text);
  expect(result.sha256).toBe(sent.sha256);
  expect(result.transferId).toBe(sent.transferId);
  expect(channel.closed).toBe(false);
  expect(channel.closeCalls).toBe(0);
  expect(Core.isChannelAuthenticated(channel)).toBe(true);
});

test('P2P roster transfer rejects corrupt hash, duplicate chunks and missing chunks', async () => {
  const channel=new CaptureChannel();
  Core.markChannelAuthenticated(channel);
  await Core.sendPayload(channel,{kind:'roster',schema:'sa-roster/v1',text:'x'.repeat(Core.CHUNK_SIZE+50)});
  let hashError=null;
  const hashReceiver=Core.createTransferReceiver({channel:authenticatedChannel(),onError:e=>{hashError=e;}});
  await deliver(channel.frames,hashReceiver,(frame,index)=>{if(index!==0)return frame;const m=JSON.parse(frame);m.sha256='0'.repeat(64);return JSON.stringify(m);});
  expect(hashError?.message).toMatch(/SHA-256 no coincide/);

  const start=channel.frames[0], chunks=channel.frames.slice(1,-1), end=channel.frames.at(-1);
  let duplicateError=null;
  const duplicateReceiver=Core.createTransferReceiver({channel:authenticatedChannel(),onError:e=>{duplicateError=e;}});
  await duplicateReceiver({data:start}); await duplicateReceiver({data:chunks[0]}); await duplicateReceiver({data:chunks[0]});
  expect(duplicateError?.message).toMatch(/Chunk duplicado/);

  let missingError=null;
  const missingReceiver=Core.createTransferReceiver({channel:authenticatedChannel(),onError:e=>{missingError=e;}});
  await missingReceiver({data:start}); await missingReceiver({data:chunks[0]}); await missingReceiver({data:end});
  expect(missingError?.message).toMatch(/Faltan chunks/);
});

test('pairing closes lost-initial-hello race and persists initiator only after receiver ACK', async () => {
  const [saChannel,miniChannel]=linkedPair();
  const saStore=makeStore();
  let releaseMiniSave; const miniSaved=[];
  const miniStore={savePeer(peer){return new Promise(resolve=>{releaseMiniSave=()=>{miniSaved.push({...peer});resolve({...peer});};});}};
  const descriptor=await Core.pairDescriptorFromManual('583214','ABCDE-23456');
  descriptor.issuerId='sa-device'; descriptor.issuerApp='sa'; descriptor.issuerName='SA';
  const saSelf={deviceId:'sa-device',appType:'sa',displayName:'SA'};
  const miniSelf={deviceId:'mini-device',appType:'mini',displayName:'Mini'};
  let saCandidate,miniCandidate,saLinked=false,miniLinked=false,error=null;
  Pairing.attachPairing(saChannel,{self:saSelf,descriptor,initiator:true,store:saStore,onCandidate:c=>{saCandidate=c;},onLinked:()=>{saLinked=true;},onError:e=>{error=e;}});
  Pairing.attachPairing(miniChannel,{self:miniSelf,descriptor,initiator:false,store:miniStore,onCandidate:c=>{miniCandidate=c;},onLinked:()=>{miniLinked=true;},onError:e=>{error=e;}});
  await waitFor(()=>saCandidate&&miniCandidate,'both candidates');
  expect(error).toBeNull(); expect(saCandidate.sas).toBe(miniCandidate.sas);
  await saCandidate.accept(); await miniCandidate.accept();
  await waitFor(()=>typeof releaseMiniSave==='function','receiver save');
  expect(saStore.saved).toHaveLength(0); expect(saLinked).toBe(false);
  releaseMiniSave();
  await waitFor(()=>saLinked&&miniLinked,'bilateral link');
  expect(saStore.saved).toHaveLength(1); expect(miniSaved).toHaveLength(1);
  expect(saStore.saved[0].linkToken).toBe(miniSaved[0].linkToken);
  expect(Core.isChannelAuthenticated(saChannel)).toBe(true);
  expect(Core.isChannelAuthenticated(miniChannel)).toBe(true);
});

test('trusted reconnect closes lost-initial-challenge race with mutual HMAC', async () => {
  const [saChannel,miniChannel]=linkedPair(); const token=Core.randomToken(32);
  let saOk=false,miniOk=false,error=null;
  Pairing.attachTrusted(saChannel,{self:{deviceId:'sa-device',appType:'sa',displayName:'SA'},peer:{peerId:'mini-device',peerApp:'mini',displayName:'Mini',linkToken:token},store:makeStore(),onAuthenticated:()=>{saOk=true;},onError:e=>{error=e;}});
  Pairing.attachTrusted(miniChannel,{self:{deviceId:'mini-device',appType:'mini',displayName:'Mini'},peer:{peerId:'sa-device',peerApp:'sa',displayName:'SA',linkToken:token},store:makeStore(),onAuthenticated:()=>{miniOk=true;},onError:e=>{error=e;}});
  await waitFor(()=>saOk&&miniOk,'mutual auth');
  expect(error).toBeNull();
  expect(Core.isChannelAuthenticated(saChannel)).toBe(true);
  expect(Core.isChannelAuthenticated(miniChannel)).toBe(true);
});

test('trusted reconnect ignores valid handshake frames delivered after authentication', async () => {
  const [saChannel, miniChannel] = controlledLinkedPair();
  const token = Core.randomToken(Core.LINK_TOKEN_BYTES);
  const saErrors = [];
  const miniErrors = [];
  let saAuthCount = 0;
  let miniAuthCount = 0;
  Pairing.attachTrusted(saChannel, {
    self:{deviceId:'sa-device',appType:'sa',displayName:'SA'},
    peer:{peerId:'mini-device',peerApp:'mini',displayName:'Mini',linkToken:token},
    store:makeStore(),
    onAuthenticated:()=>{saAuthCount+=1;},
    onError:error=>saErrors.push(error)
  });
  Pairing.attachTrusted(miniChannel, {
    self:{deviceId:'mini-device',appType:'mini',displayName:'Mini'},
    peer:{peerId:'sa-device',peerApp:'sa',displayName:'SA',linkToken:token},
    store:makeStore(),
    onAuthenticated:()=>{miniAuthCount+=1;},
    onError:error=>miniErrors.push(error)
  });

  await waitFor(() => saChannel.pending.length === 1 && miniChannel.pending.length === 1, 'initial trusted hellos');
  await miniChannel.deliverNext();
  await saChannel.deliverNext();
  await miniChannel.deliverNext();
  await saChannel.deliverNext();
  expect(saAuthCount).toBe(1);
  expect(miniAuthCount).toBe(1);
  expect(saChannel.pending).toHaveLength(1);
  expect(miniChannel.pending).toHaveLength(1);

  await saChannel.deliverNext();
  await miniChannel.deliverNext();
  expect(saErrors).toHaveLength(0);
  expect(miniErrors).toHaveLength(0);
  expect(saAuthCount).toBe(1);
  expect(miniAuthCount).toBe(1);
  expect(Core.isChannelAuthenticated(saChannel)).toBe(true);
  expect(Core.isChannelAuthenticated(miniChannel)).toBe(true);
});

test('trusted reconnect rejects a mismatched persisted secret', async () => {
  const [saChannel,miniChannel]=linkedPair(); let error=null,authenticated=false;
  Pairing.attachTrusted(saChannel,{self:{deviceId:'sa-device',appType:'sa',displayName:'SA'},peer:{peerId:'mini-device',peerApp:'mini',displayName:'Mini',linkToken:Core.randomToken(32)},store:makeStore(),onAuthenticated:()=>{authenticated=true;},onError:e=>{error=e;}});
  Pairing.attachTrusted(miniChannel,{self:{deviceId:'mini-device',appType:'mini',displayName:'Mini'},peer:{peerId:'sa-device',peerApp:'sa',displayName:'SA',linkToken:Core.randomToken(32)},store:makeStore(),onAuthenticated:()=>{authenticated=true;},onError:e=>{error=e;}});
  await waitFor(()=>error,'HMAC mismatch');
  expect(authenticated).toBe(false);
  expect(error.message).toMatch(/Autenticación|confianza/);
  expect(saChannel.closed || miniChannel.closed).toBe(true);
  expect(Core.isChannelAuthenticated(saChannel)).toBe(false);
  expect(Core.isChannelAuthenticated(miniChannel)).toBe(false);
});

test('sendPayload is authenticated, roster-only, hard-capped, and ignores caller limits', async () => {
  const unauthenticated = new CaptureChannel();
  await expect(Core.sendPayload(unauthenticated, { kind:'roster', schema:'sa-roster/v1', text:'x' })).rejects.toThrow(/no autenticado/);

  const channel = new CaptureChannel();
  Core.markChannelAuthenticated(channel);
  await expect(Core.sendPayload(channel, { kind:'payload', schema:'anything', text:'x' })).rejects.toThrow(/Sólo se admite/);
  await expect(Core.sendPayload(channel, { kind:'roster', schema:'sa-roster/v2', text:'x' })).rejects.toThrow(/Sólo se admite/);
  const transfer = await Core.sendPayload(channel, { kind:'roster', schema:'sa-roster/v1', text:'two', maxBytes:1 });
  expect(transfer.kind).toBe('roster');
  expect(transfer.schema).toBe('sa-roster/v1');
  expect(JSON.parse(channel.frames[0]).chunkSize).toBe(Core.CHUNK_SIZE);

  const receiver = Core.createTransferReceiver({ channel, maxBytes: 1, onComplete: () => {} });
  await deliver(channel.frames, receiver);
  await expect(Core.sendPayload(channel, {
    kind:'roster', schema:'sa-roster/v1', text:'x'.repeat(Core.MAX_ROSTER_BYTES + 1), maxBytes:Core.MAX_ROSTER_BYTES * 2
  })).rejects.toThrow(/límite/);
});

test('zero-size roster uses totalChunks=0 and has no binary chunk', async () => {
  const channel = new CaptureChannel();
  Core.markChannelAuthenticated(channel);
  const sent = await Core.sendPayload(channel, { kind:'roster', schema:'sa-roster/v1', text:'' });
  expect(sent.totalChunks).toBe(0);
  expect(channel.frames).toHaveLength(2);
  expect(JSON.parse(channel.frames[0]).totalChunks).toBe(0);
  let result;
  const receiver = Core.createTransferReceiver({ channel, onComplete: value => { result = value; } });
  await deliver(channel.frames, receiver);
  expect(result.text).toBe('');
});

test('receiver rejects malformed transfer framing and non-canonical chunk lengths', async () => {
  const channel = new CaptureChannel();
  Core.markChannelAuthenticated(channel);
  await Core.sendPayload(channel, { kind:'roster', schema:'sa-roster/v1', text:'x'.repeat(Core.CHUNK_SIZE + 5) });
  const start = JSON.parse(channel.frames[0]);
  const chunks = channel.frames.slice(1, -1);
  const end = JSON.parse(channel.frames.at(-1));

  let error;
  const badStart = Core.createTransferReceiver({ channel:authenticatedChannel(), onError: e => { error = e; } });
  await badStart({ data: JSON.stringify({ ...start, totalChunks: 1 }) });
  expect(error?.message).toMatch(/Cantidad de chunks/);

  error = null;
  const extraStart = Core.createTransferReceiver({ channel:authenticatedChannel(), onError: e => { error = e; } });
  await extraStart({ data: JSON.stringify({ ...start, application: { roster: 'bytes' } }) });
  expect(error?.message).toMatch(/Inicio de transferencia/);

  error = null;
  const shortChunk = new Uint8Array(chunks[0]);
  await shortChunkReceiver(extraStart, shortChunk);

  async function shortChunkReceiver(_, raw) {
    const receiver = Core.createTransferReceiver({ channel:authenticatedChannel(), onError: e => { error = e; } });
    await receiver({ data: JSON.stringify(start) });
    await receiver({ data: raw.slice(0, raw.byteLength - 1).buffer });
    expect(error?.message).toMatch(/Longitud de chunk/);
  }

  error = null;
  const oversizedFinal = Core.createTransferReceiver({ channel:authenticatedChannel(), onError: e => { error = e; } });
  await oversizedFinal({ data: JSON.stringify(start) });
  await oversizedFinal({ data: chunks[0] });
  const final = new Uint8Array(chunks[1]);
  const enlarged = new Uint8Array(final.byteLength + 1);
  enlarged.set(final);
  await oversizedFinal({ data: enlarged.buffer });
  expect(error?.message).toMatch(/Longitud de chunk/);
  expect(end.transferId).toBe(start.transferId);
});

test('linkToken is exactly canonical base64url for 32 bytes and savePeer enforces it', () => {
  const token = Core.randomToken(32);
  expect(Core.validateLinkToken(token)).toBe(token);
  expect(() => Core.validateLinkToken(token + '=')).toThrow();
  expect(() => Core.validateLinkToken('a'.repeat(42))).toThrow();
  expect(() => Core.validateLinkToken('!'.repeat(43))).toThrow();
  expect(() => Core.validateControlFrame({
    protocol:Core.CONTROL_PROTOCOL,
    type:'pair-link',
    data:{
      linkToken:'short', sessionId:'0'.repeat(64), initiatorId:'sa-device', receiverId:'mini-device', mac:'0'.repeat(64)
    }
  })).toThrow(/Token persistente/);

  const store = Core.makeIdentityStore('sa');
  expect(() => store.savePeer({ peerId:'mini-device', peerApp:'mini', linkToken:'short' })).toThrow(/Token persistente/);
  expect(() => store.savePeer({ peerId:'sa-device', peerApp:'sa', linkToken:token })).toThrow(/app remota/);
});

test('roster-staged ACK requires the exact transfer identity and validation fields', async () => {
  const transfer = { transferId:'transfer-1', sha256:'a'.repeat(64), kind:'roster', schema:'sa-roster/v1' };
  expect(Core.validateRosterStageAck({ ...transfer, validated:true }, transfer)).toEqual({ ...transfer, validated:true });
  expect(() => Core.validateRosterStageAck({ ...transfer, validated:false }, transfer)).toThrow();
  expect(() => Core.validateRosterStageAck({ ...transfer, validated:true, extra:'payload' }, transfer)).toThrow();
  expect(() => Core.validateRosterStageAck({ ...transfer, validated:true, sha256:'b'.repeat(64) }, transfer)).toThrow();
});

test('pair session IDs bind proof, role IDs, and both nonces in canonical order', async () => {
  const proof = 'a'.repeat(64);
  const initiatorNonce = Core.randomToken(16);
  const receiverNonce = Core.randomToken(16);
  const sessionId = await Core.makePairSessionId(
    proof, 'sa-device', 'mini-device', initiatorNonce, receiverNonce
  );
  const expected = await Core.sha256Hex(
    `pair-session:v1:${proof}:sa-device:mini-device:${initiatorNonce}:${receiverNonce}`
  );
  expect(sessionId).toBe(expected);
  expect(sessionId).toMatch(/^[a-f0-9]{64}$/);
  await expect(Core.makePairSessionId(
    proof, 'sa-device', 'mini-device', receiverNonce, initiatorNonce
  )).resolves.not.toBe(sessionId);
});

test('control schemas are exact and roster rejection is canonical', () => {
  const nonce = Core.randomToken(16);
  const token = Core.randomToken(Core.LINK_TOKEN_BYTES);
  const sessionId = '1'.repeat(64);
  const mac = '2'.repeat(64);
  const samples = {
    'pair-hello': { deviceId:'sa-device', appType:'sa', displayName:'SA', nonce },
    'pair-accept': { deviceId:'mini-device', sessionId },
    'pair-reject': { deviceId:'mini-device' },
    'pair-link': { linkToken:token, sessionId, initiatorId:'sa-device', receiverId:'mini-device', mac },
    'pair-linked': { linkToken:token, sessionId, initiatorId:'sa-device', receiverId:'mini-device', mac },
    'trusted-hello': { deviceId:'sa-device', peerId:'mini-device', nonce, mac },
    'trusted-ok': { deviceId:'mini-device', peerId:'sa-device', nonce, mac },
    'roster-staged': { transferId:'transfer-1', sha256:'3'.repeat(64), kind:'roster', schema:'sa-roster/v1', validated:true },
    'roster-rejected': { transferId:'transfer-1', reason:'invalid roster', kind:'roster', schema:'sa-roster/v1', validated:false }
  };
  for (const [type, data] of Object.entries(samples)) {
    expect(Core.validateControlFrame({ protocol:Core.CONTROL_PROTOCOL, type, data })).toEqual({
      protocol:Core.CONTROL_PROTOCOL, type, data
    });
    expect(() => Core.validateControlFrame({
      protocol:Core.CONTROL_PROTOCOL, type, data:{ ...data, extra:'unexpected' }
    })).toThrow();
  }
  expect(Core.validateRosterRejected(samples['roster-rejected'], { transferId:'transfer-1' })).toEqual(samples['roster-rejected']);
  expect(() => Core.validateRosterRejected(samples['roster-rejected'], { transferId:'other-transfer' })).toThrow();
});

test('trusted authentication requires the canonical target peerId', async () => {
  const [saChannel, miniChannel] = linkedPair();
  const errors = [];
  miniChannel.transform = data => {
    if (typeof data !== 'string') return data;
    const message = JSON.parse(data);
    if (message.type === 'trusted-hello') message.data.peerId = 'wrong-target';
    return JSON.stringify(message);
  };
  Pairing.attachTrusted(saChannel, {
    self:{deviceId:'sa-device',appType:'sa',displayName:'SA'},
    peer:{peerId:'mini-device',peerApp:'mini',displayName:'Mini',linkToken:Core.randomToken(Core.LINK_TOKEN_BYTES)},
    store:makeStore(), onError:error=>errors.push(error)
  });
  Pairing.attachTrusted(miniChannel, {
    self:{deviceId:'mini-device',appType:'mini',displayName:'Mini'},
    peer:{peerId:'sa-device',peerApp:'sa',displayName:'SA',linkToken:Core.randomToken(Core.LINK_TOKEN_BYTES)},
    store:makeStore(), onError:error=>errors.push(error)
  });
  await waitFor(() => errors.length > 0, 'target peerId rejection');
  expect(errors[0].message).toMatch(/dispositivo conectado|autenticación|vinculado/i);
  expect(saChannel.closed || miniChannel.closed).toBe(true);
  expect(Core.isChannelAuthenticated(saChannel)).toBe(false);
});

test('transfer receiver fails closed when its channel is not authenticated', async () => {
  const source = new CaptureChannel();
  Core.markChannelAuthenticated(source);
  await Core.sendPayload(source, { kind:'roster', schema:'sa-roster/v1', text:'secure' });
  const unauthenticated = new CaptureChannel();
  let error = null;
  let complete = false;
  const receiver = Core.createTransferReceiver({
    channel: unauthenticated,
    onComplete:() => { complete = true; },
    onError:e => { error = e; }
  });
  const handled = await receiver({ data:source.frames[0] });
  expect(handled).toBe(true);
  expect(error?.message).toMatch(/no autenticado/);
  expect(complete).toBe(false);
  expect(unauthenticated.closed).toBe(true);
});

test('transfer receiver rejects null or omitted channels before staging data', async () => {
  const source = authenticatedChannel();
  await Core.sendPayload(source, { kind:'roster', schema:'sa-roster/v1', text:'secure' });

  for (const options of [{ channel:null }, {}]) {
    let error = null;
    let complete = false;
    const receiver = Core.createTransferReceiver({
      ...options,
      onComplete:() => { complete = true; },
      onError:e => { error = e; }
    });
    await deliver(source.frames, receiver);
    expect(error?.message).toMatch(/no autenticado/);
    expect(complete).toBe(false);
  }
});

test('transfer receiver rejects invalid UTF-8 before onComplete', async () => {
  const channel = new CaptureChannel();
  Core.markChannelAuthenticated(channel);
  const bytes = new Uint8Array([0xc3, 0x28]);
  const transferId = 'transfer-invalid-utf8';
  const start = JSON.stringify({
    protocol:Core.TRANSFER_PROTOCOL, type:'start', transferId, kind:'roster', schema:'sa-roster/v1',
    size:bytes.byteLength, chunkSize:Core.CHUNK_SIZE, totalChunks:1, sha256:await Core.sha256Hex(bytes)
  });
  const chunk = new Uint8Array(4 + bytes.byteLength);
  new DataView(chunk.buffer).setUint32(0, 0);
  chunk.set(bytes, 4);
  let error = null;
  let complete = false;
  const receiver = Core.createTransferReceiver({
    channel,
    onComplete:() => { complete = true; },
    onError:e => { error = e; }
  });
  await receiver({ data:start });
  await receiver({ data:chunk.buffer });
  await receiver({ data:JSON.stringify({ protocol:Core.TRANSFER_PROTOCOL, type:'end', transferId }) });
  expect(error?.message).toMatch(/UTF-8/);
  expect(complete).toBe(false);
  expect(channel.closed).toBe(true);
  expect(channel.closeCalls).toBe(1);
  expect(Core.isChannelAuthenticated(channel)).toBe(false);
});

test('authenticated transfer protocol failures revoke and close the channel exactly once', async () => {
  const source = new CaptureChannel();
  Core.markChannelAuthenticated(source);
  await Core.sendPayload(source, { kind:'roster', schema:'sa-roster/v1', text:'x'.repeat(Core.CHUNK_SIZE + 50) });
  const start = source.frames[0];
  const chunks = source.frames.slice(1, -1);
  const end = source.frames.at(-1);

  const expectFailure = async frames => {
    const channel = new CaptureChannel();
    Core.markChannelAuthenticated(channel);
    let error = null;
    const receiver = Core.createTransferReceiver({ channel, onError:e => { error = e; } });
    await deliver(frames, receiver);
    await receiver({ data:'{' });
    expect(error).toBeTruthy();
    expect(channel.closed).toBe(true);
    expect(channel.closeCalls).toBe(1);
    expect(Core.isChannelAuthenticated(channel)).toBe(false);
  };

  await expectFailure(['{']);
  await expectFailure([start, chunks[0], chunks[0]]);
  await expectFailure([start, chunks[0], end]);
  await expectFailure([JSON.stringify({ ...JSON.parse(start), sha256:'0'.repeat(64) }), ...chunks, end]);
  await expectFailure([JSON.stringify({
    ...JSON.parse(start),
    size:Core.MAX_ROSTER_BYTES + 1,
    totalChunks:Math.ceil((Core.MAX_ROSTER_BYTES + 1) / Core.CHUNK_SIZE)
  })]);
});

test('pair-linked ACK is bound to proof, both device IDs, and the token', async () => {
  const [saChannel, miniChannel] = linkedPair();
  const descriptor = await Core.pairDescriptorFromManual('583214', 'ABCDE-23456');
  descriptor.issuerId = 'sa-device'; descriptor.issuerApp = 'sa'; descriptor.issuerName = 'SA';
  const saSelf = { deviceId:'sa-device', appType:'sa', displayName:'SA' };
  const miniSelf = { deviceId:'mini-device', appType:'mini', displayName:'Mini' };
  let saCandidate, miniCandidate, error = null, saLinked = false;
  miniChannel.transform = data => {
    if (typeof data !== 'string') return data;
    const message = JSON.parse(data);
    if (message.type !== 'pair-linked') return data;
    message.data.mac = '0'.repeat(64);
    return JSON.stringify(message);
  };
  Pairing.attachPairing(saChannel, { self:saSelf, descriptor, initiator:true, store:makeStore(), onCandidate:c=>{saCandidate=c;}, onLinked:()=>{saLinked=true;}, onError:e=>{error=e;} });
  Pairing.attachPairing(miniChannel, { self:miniSelf, descriptor, initiator:false, store:makeStore(), onCandidate:c=>{miniCandidate=c;}, onError:e=>{error=e;} });
  await waitFor(() => saCandidate && miniCandidate, 'pairing candidates');
  await saCandidate.accept(); await miniCandidate.accept();
  await waitFor(() => error, 'bound ACK rejection');
  expect(saLinked).toBe(false);
  expect(error.message).toMatch(/ACK de vínculo/);
  expect(saChannel.closed || miniChannel.closed).toBe(true);
});

test('pairing rejects same-role peers and expired manual sessions', async () => {
  const [saChannel, otherSaChannel] = linkedPair();
  const descriptor = await Core.pairDescriptorFromManual('583214', 'ABCDE-23456');
  descriptor.issuerId = 'sa-device'; descriptor.issuerApp = 'sa';
  let error = null;
  Pairing.attachPairing(saChannel, { self:{deviceId:'sa-device',appType:'sa',displayName:'SA'}, descriptor, initiator:true, store:makeStore(), onError:e=>{error=e;} });
  Pairing.attachPairing(otherSaChannel, { self:{deviceId:'other-sa',appType:'sa',displayName:'SA 2'}, descriptor, initiator:false, store:makeStore(), onError:e=>{error=e;} });
  await waitFor(() => error, 'same-role rejection');
  expect(error.message).toMatch(/app remota|Mini/);

  const [expiredA, expiredB] = linkedPair();
  const expired = { ...descriptor, expiresAt: Date.now() - 1 };
  let expiredError = null;
  Pairing.attachPairing(expiredA, { self:{deviceId:'sa-device',appType:'sa',displayName:'SA'}, descriptor:expired, initiator:true, store:makeStore(), onError:e=>{expiredError=e;} });
  expect(expiredError?.message).toMatch(/expir/);
  expect(expiredA.closed).toBe(true);
  expect(Core.isChannelAuthenticated(expiredB)).toBe(false);
});

test('signaling socket close and ICE send failure revoke the RTC session', async () => {
  const previous = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePeerConnection;
  window.RTCPeerConnection = FakePeerConnection;
  try {
    const socketSignaling = new FakeSignaling();
    const socketSession = await Core.createRtcSession({ signaling:socketSignaling, initiator:true });
    Core.markChannelAuthenticated(socketSession.channel);
    socketSignaling.emit({ type:'socket-closed', reason:'network lost' });
    await waitFor(() => socketSession.isClosed(), 'socket-close revoke');
    expect(socketSession.channel.closed).toBe(true);
    expect(Core.isChannelAuthenticated(socketSession.channel)).toBe(false);

    const iceSignaling = new FakeSignaling();
    iceSignaling.send = () => { throw new Error('ICE send failed'); };
    const iceSession = await Core.createRtcSession({ signaling:iceSignaling, initiator:true });
    Core.markChannelAuthenticated(iceSession.channel);
    iceSession.pc.onicecandidate({ candidate:{ toJSON:() => ({ candidate:'candidate:x', sdpMid:null, sdpMLineIndex:0, usernameFragment:null }) } });
    await waitFor(() => iceSession.isClosed(), 'ICE failure revoke');
    expect(iceSession.channel.closed).toBe(true);
    expect(Core.isChannelAuthenticated(iceSession.channel)).toBe(false);

    const disconnectedSignaling = new FakeSignaling();
    const disconnectedSession = await Core.createRtcSession({ signaling:disconnectedSignaling, initiator:true });
    Core.markChannelAuthenticated(disconnectedSession.channel);
    disconnectedSession.pc.iceConnectionState = 'disconnected';
    disconnectedSession.pc.oniceconnectionstatechange();
    await waitFor(() => disconnectedSession.isClosed(), 'ICE disconnected revoke');
    expect(disconnectedSession.channel.closed).toBe(true);
    expect(Core.isChannelAuthenticated(disconnectedSession.channel)).toBe(false);
  } finally {
    globalThis.RTCPeerConnection = previous;
    window.RTCPeerConnection = previous;
  }
});

test('peer departure fails closed and repeated terminal events tear down exactly once', async () => {
  const previous = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePeerConnection;
  window.RTCPeerConnection = FakePeerConnection;
  try {
    const signaling = new FakeSignaling();
    const session = await Core.createRtcSession({ signaling, initiator:true });
    Core.markChannelAuthenticated(session.channel);

    signaling.emit({ type:'peer-left' });
    await waitFor(() => session.isClosed(), 'peer departure teardown');

    expect(session.channel.closed).toBe(true);
    expect(Core.isChannelAuthenticated(session.channel)).toBe(false);
    expect(session.channel.closeCalls).toBe(1);
    expect(session.pc.closeCalls).toBe(1);
    expect(signaling.closeCalls).toBe(1);

    signaling.emit({ type:'peer-left' });
    signaling.emit({ type:'socket-closed', reason:'late socket event' });
    expect(session.channel.closeCalls).toBe(1);
    expect(session.pc.closeCalls).toBe(1);
    expect(signaling.closeCalls).toBe(1);
  } finally {
    globalThis.RTCPeerConnection = previous;
    window.RTCPeerConnection = previous;
  }
});

test('unexpected DataChannel close or error tears down RTC and signaling exactly once', async () => {
  const previous = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePeerConnection;
  window.RTCPeerConnection = FakePeerConnection;
  try {
    const closeSignaling = new FakeSignaling();
    const closeSession = await Core.createRtcSession({ signaling:closeSignaling, initiator:true });
    Core.markChannelAuthenticated(closeSession.channel);
    closeSession.channel.readyState = 'closed';
    closeSession.channel.onclose();
    await waitFor(() => closeSession.isClosed(), 'unexpected channel close teardown');
    expect(closeSession.pc.closed).toBe(true);
    expect(closeSignaling.closed).toBe(true);
    expect(closeSession.channel.closeCalls).toBe(1);
    expect(Core.isChannelAuthenticated(closeSession.channel)).toBe(false);
    closeSession.channel.onclose();
    expect(closeSession.channel.closeCalls).toBe(1);

    const errorSignaling = new FakeSignaling();
    const errorSession = await Core.createRtcSession({ signaling:errorSignaling, initiator:true });
    Core.markChannelAuthenticated(errorSession.channel);
    errorSession.channel.onerror(new Error('channel failure'));
    await waitFor(() => errorSession.isClosed(), 'channel error teardown');
    expect(errorSession.pc.closed).toBe(true);
    expect(errorSignaling.closed).toBe(true);
    expect(errorSession.channel.closeCalls).toBe(1);
    expect(Core.isChannelAuthenticated(errorSession.channel)).toBe(false);

    const cleanSignaling = new FakeSignaling();
    const states = [];
    const cleanSession = await Core.createRtcSession({
      signaling:cleanSignaling,
      initiator:true,
      onState:(state, error) => states.push({ state, error })
    });
    cleanSession.close();
    cleanSession.close();
    expect(cleanSession.pc.closed).toBe(true);
    expect(cleanSignaling.closed).toBe(true);
    expect(cleanSession.channel.closeCalls).toBe(1);
    expect(cleanSession.pc.closeCalls).toBe(1);
    expect(cleanSignaling.closeCalls).toBe(1);
    expect(states.some(({ state }) => state === 'error')).toBe(false);
  } finally {
    globalThis.RTCPeerConnection = previous;
    window.RTCPeerConnection = previous;
  }
});
