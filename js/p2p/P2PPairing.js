(function (root) {
  'use strict';
  const core = root.SaMiniP2P;
  if (!core) throw new Error('SaMiniP2P core must load before pairing module.');

  function normalizeIdentity(self) {
    if (!self || typeof self !== 'object') throw new Error('Identidad P2P inválida.');
    const deviceId = core.validateDeviceId(self.deviceId, 'deviceId local inválido.');
    const appType = String(self.appType || '').trim();
    const displayName = String(self.displayName || '').trim();
    if (!['sa', 'mini'].includes(appType)) throw new Error('Tipo de app local inválido.');
    return { deviceId, appType, displayName: displayName.slice(0, 80) || appType };
  }

  function validateHello(data, self) {
    if (!data || typeof data !== 'object') throw new Error('Identidad P2P inválida.');
    const deviceId = core.validateDeviceId(data.deviceId, 'deviceId remoto inválido.');
    const appType = String(data.appType || '').trim();
    const displayName = String(data.displayName || '').trim();
    const nonce = String(data.nonce || '').trim();
    if (!['sa', 'mini'].includes(appType) || appType === self.appType) throw new Error('La app remota P2P no es compatible.');
    if (self.appType === 'sa' && appType !== 'mini') throw new Error('SA sólo puede vincular Mini.');
    if (self.appType === 'mini' && appType !== 'sa') throw new Error('Mini sólo puede vincular SA.');
    if (!nonce || nonce.length > 128) throw new Error('Nonce remoto inválido.');
    return { deviceId, appType, displayName: displayName.slice(0, 80) || appType, nonce };
  }

  function assertDescriptor(descriptor, self, initiator) {
    if (!descriptor || descriptor.v !== 1 || descriptor.room !== 'pair-' + descriptor.code) throw new Error('Descriptor de emparejamiento inválido.');
    core.normalizeCode(descriptor.code);
    core.normalizePairKey(descriptor.key);
    if (!/^[a-f0-9]{64}$/i.test(String(descriptor.proof || ''))) throw new Error('Prueba de emparejamiento inválida.');
    core.assertPairSessionActive(descriptor.expiresAt);
    if (descriptor.issuerApp && descriptor.issuerApp !== 'sa') throw new Error('SA debe ser el emisor del emparejamiento.');
    if (initiator && descriptor.issuerId && descriptor.issuerId !== self.deviceId) throw new Error('El descriptor no pertenece a este SA.');
  }

  function expectedPeerApp(appType) {
    return appType === 'sa' ? 'mini' : 'sa';
  }

  function attachPairing(channel, { self, descriptor, initiator, store, onCandidate, onLinked, onRejected, onError }) {
    const local = normalizeIdentity(self);
    let finished = false;
    try { assertDescriptor(descriptor, local, initiator); }
    catch (error) {
      core.revokeChannel(channel, error);
      onError?.(error);
      return { accept: async () => { throw error; }, reject: () => {}, detach: () => {}, isAuthenticated: () => false };
    }
    descriptor = { ...descriptor, proof: String(descriptor.proof).toLowerCase() };

    const localNonce = core.randomToken(16);
    let remote = null;
    let localAccepted = false;
    let remoteAccepted = false;
    let linkToken = null;
    let sessionId = null;
    let helloEchoed = false;
    let candidateShown = false;

    const fail = error => {
      if (finished) return;
      finished = true;
      const failure = error instanceof Error ? error : new Error(String(error));
      core.revokeChannel(channel, failure);
      onError?.(failure);
    };
    const sendHello = () => core.sendControl(channel, 'pair-hello', {
      deviceId: local.deviceId, appType: local.appType, displayName: local.displayName, nonce: localNonce
    });
    const maybeLink = async () => {
      if (!initiator || finished || !remote || !sessionId || !localAccepted || !remoteAccepted || linkToken) return;
      core.assertPairSessionActive(descriptor.expiresAt);
      linkToken = core.randomToken(core.LINK_TOKEN_BYTES);
      const initiatorId = local.deviceId;
      const receiverId = remote.deviceId;
      const mac = await core.makePairLinkMac('pair-link', descriptor.proof, sessionId, initiatorId, receiverId, linkToken);
      core.sendControl(channel, 'pair-link', { linkToken, sessionId, initiatorId, receiverId, mac });
    };

    const accept = async () => {
      if (!remote || localAccepted || finished) return;
      try {
        core.assertPairSessionActive(descriptor.expiresAt);
        localAccepted = true;
        if (!sessionId) throw new Error('La sesión de emparejamiento aún no está identificada.');
        core.sendControl(channel, 'pair-accept', { deviceId: local.deviceId, sessionId });
        await maybeLink();
      } catch (error) {
        fail(error);
        throw error;
      }
    };
    const reject = () => {
      if (finished) return;
      try { core.sendControl(channel, 'pair-reject', { deviceId: local.deviceId }); }
      catch (error) { fail(error); return; }
      finished = true;
      core.revokeChannel(channel, new Error('Emparejamiento rechazado.'));
      onRejected?.();
    };

    const handler = async event => {
      let msg;
      try { msg = core.parseControl(event.data); }
      catch (error) { fail(error); return; }
      if (!msg || finished) return;
      try {
        core.assertPairSessionActive(descriptor.expiresAt);
        if (msg.type === 'pair-hello') {
          const incoming = validateHello(msg.data, local);
          if (remote && (remote.deviceId !== incoming.deviceId || remote.appType !== incoming.appType || remote.nonce !== incoming.nonce)) {
            throw new Error('La identidad P2P cambió durante el emparejamiento.');
          }
          remote = incoming;
          const initiatorId = initiator ? local.deviceId : remote.deviceId;
          const receiverId = initiator ? remote.deviceId : local.deviceId;
          const derivedSessionId = await core.makePairSessionId(
            descriptor.proof,
            initiatorId,
            receiverId,
            initiator ? localNonce : remote.nonce,
            initiator ? remote.nonce : localNonce
          );
          if (sessionId && sessionId !== derivedSessionId) throw new Error('La sesión de emparejamiento cambió.');
          sessionId = derivedSessionId;
          if (descriptor.issuerId && !initiator && descriptor.issuerId !== remote.deviceId) {
            throw new Error('El dispositivo del QR no coincide con el emisor conectado.');
          }
          if (remote.appType !== expectedPeerApp(local.appType)) throw new Error('La app remota P2P no es compatible.');
          if (!helloEchoed) { helloEchoed = true; sendHello(); }
          if (!candidateShown) {
            candidateShown = true;
            const sas = await core.makeSas(localNonce, remote.nonce, descriptor.code + ':' + descriptor.key);
            onCandidate?.({ remote, sas, accept, reject });
          }
        } else if (msg.type === 'pair-accept') {
          if (!remote || !sessionId || msg.data.deviceId !== remote.deviceId || msg.data.sessionId !== sessionId) {
            throw new Error('Confirmación P2P no vinculada a la sesión remota.');
          }
          remoteAccepted = true;
          await maybeLink();
        } else if (msg.type === 'pair-reject') {
          if (remote && msg.data.deviceId !== remote.deviceId) throw new Error('Rechazo P2P no vinculado al dispositivo remoto.');
          finished = true;
          core.revokeChannel(channel, new Error('Emparejamiento rechazado.'));
          onRejected?.();
        } else if (msg.type === 'pair-link') {
          if (initiator) throw new Error('El iniciador no puede recibir pair-link.');
          if (!localAccepted || !remoteAccepted || !remote || !sessionId) throw new Error('Token de vínculo recibido antes de confirmar ambos dispositivos.');
          if (
            msg.data.sessionId !== sessionId
            || msg.data.initiatorId !== remote.deviceId
            || msg.data.receiverId !== local.deviceId
          ) throw new Error('El token no pertenece a esta sesión de emparejamiento.');
          const token = core.validateLinkToken(msg.data.linkToken);
          const expectedMac = await core.makePairLinkMac(
            'pair-link', descriptor.proof, sessionId, msg.data.initiatorId, msg.data.receiverId, token
          );
          if (msg.data.mac !== expectedMac) throw new Error('Enlace P2P no autenticado.');
          const peer = await store.savePeer({
            peerId: remote.deviceId, peerApp: remote.appType, displayName: remote.displayName,
            linkToken: token, linkedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString()
          });
           const mac = await core.makePairLinkMac(
             'pair-linked', descriptor.proof, sessionId, msg.data.initiatorId, msg.data.receiverId, token
           );
           core.sendControl(channel, 'pair-linked', {
             linkToken: token,
             sessionId,
             initiatorId: msg.data.initiatorId,
             receiverId: msg.data.receiverId,
             mac
           });
           core.markChannelAuthenticated(channel);
           onLinked?.(peer);
           finished = true;
        } else if (msg.type === 'pair-linked') {
          if (!initiator) throw new Error('El receptor no puede recibir pair-linked.');
          if (!linkToken || !remote || !sessionId) throw new Error('ACK de vínculo recibido antes del token de vínculo.');
          if (
            msg.data.linkToken !== linkToken
            || msg.data.sessionId !== sessionId
            || msg.data.initiatorId !== local.deviceId
            || msg.data.receiverId !== remote.deviceId
          ) throw new Error('ACK de vínculo no pertenece a esta sesión.');
          const expected = await core.makePairLinkMac(
            'pair-linked', descriptor.proof, sessionId, msg.data.initiatorId, msg.data.receiverId, linkToken
          );
          if (msg.data.mac !== expected) throw new Error('ACK de vínculo no autenticado.');
          const peer = await store.savePeer({
            peerId: remote.deviceId, peerApp: remote.appType, displayName: remote.displayName,
            linkToken, linkedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString()
          });
          core.markChannelAuthenticated(channel);
          onLinked?.(peer);
          finished = true;
        }
      } catch (error) { fail(error); }
    };
    channel.addEventListener('message', handler);
    try { sendHello(); } catch (error) { fail(error); }
    return {
      accept,
      reject,
      detach: () => channel.removeEventListener('message', handler),
      isAuthenticated: () => core.isChannelAuthenticated(channel)
    };
  }

  function validateTrustedPeer(self, peer) {
    if (!peer || typeof peer !== 'object') throw new Error('Peer vinculado inválido.');
    const peerId = core.validateDeviceId(peer.peerId, 'Peer vinculado inválido.');
    if (peerId === self.deviceId) throw new Error('Peer vinculado inválido.');
    if (peer.peerApp !== expectedPeerApp(self.appType)) throw new Error('La app remota P2P no es compatible.');
    core.validateLinkToken(peer.linkToken);
    return { ...peer, peerId };
  }

  function trustedHelloMac(token, senderId, receiverId, nonce) {
    return core.hmacHex(token, 'trusted-hello:v1:' + senderId + ':' + receiverId + ':' + nonce);
  }

  function trustedOkMac(token, senderId, receiverId, nonce) {
    return core.hmacHex(token, 'trusted-ok:v1:' + senderId + ':' + receiverId + ':' + nonce);
  }

  function attachTrusted(channel, { self, peer, store, onAuthenticated, onError }) {
    const local = normalizeIdentity(self);
    let trustedPeer;
    try { trustedPeer = validateTrustedPeer(local, peer); }
    catch (error) {
      core.revokeChannel(channel, error);
      onError?.(error);
      return { detach: () => {}, isAuthenticated: () => false };
    }

    const localNonce = core.randomToken(16);
    let helloVerified = false;
    let okVerified = false;
    let done = false;
    let failed = false;
    let completing = false;
    let helloEchoed = false;
    const fail = error => {
      if (failed) return;
      failed = true;
      done = true;
      const failure = error instanceof Error ? error : new Error(String(error));
      core.revokeChannel(channel, failure);
      onError?.(failure);
    };
    const sendHello = async () => {
      const mac = await trustedHelloMac(trustedPeer.linkToken, local.deviceId, trustedPeer.peerId, localNonce);
      core.sendControl(channel, 'trusted-hello', {
        deviceId: local.deviceId,
        peerId: trustedPeer.peerId,
        nonce: localNonce,
        mac
      });
    };
    const complete = async () => {
      if (done || completing || !helloVerified || !okVerified) return;
      completing = true;
      try {
        if (store?.savePeer) await store.savePeer({ ...trustedPeer, lastSeenAt: new Date().toISOString() });
        core.markChannelAuthenticated(channel);
        onAuthenticated?.();
        done = true;
      } catch (error) { fail(error); }
    };

    const handler = async event => {
      let msg;
      try { msg = core.parseControl(event.data); }
      catch (error) { fail(error); return; }
      if (!msg) return;
      if (done) return;
      try {
        if (msg.type === 'trusted-hello') {
          if (msg.data.deviceId !== trustedPeer.peerId || msg.data.peerId !== local.deviceId) {
            throw new Error('El dispositivo conectado no coincide con el dispositivo vinculado.');
          }
          const expected = await trustedHelloMac(trustedPeer.linkToken, msg.data.deviceId, msg.data.peerId, msg.data.nonce);
          if (msg.data.mac !== expected) throw new Error('Autenticación del dispositivo vinculado falló.');
          helloVerified = true;
          const response = await trustedOkMac(trustedPeer.linkToken, local.deviceId, msg.data.deviceId, msg.data.nonce);
          core.sendControl(channel, 'trusted-ok', {
            deviceId: local.deviceId,
            peerId: msg.data.deviceId,
            nonce: msg.data.nonce,
            mac: response
          });
          if (!helloEchoed) { helloEchoed = true; await sendHello(); }
          await complete();
        } else if (msg.type === 'trusted-ok') {
          if (
            msg.data.deviceId !== trustedPeer.peerId
            || msg.data.peerId !== local.deviceId
            || msg.data.nonce !== localNonce
          ) throw new Error('Respuesta de confianza inválida.');
          const expected = await trustedOkMac(trustedPeer.linkToken, msg.data.deviceId, msg.data.peerId, msg.data.nonce);
          if (msg.data.mac !== expected) throw new Error('Prueba de confianza inválida.');
          okVerified = true;
          await complete();
        }
      } catch (error) { fail(error); }
    };
    channel.addEventListener('message', handler);
    sendHello().catch(fail);
    return { detach: () => channel.removeEventListener('message', handler), isAuthenticated: () => core.isChannelAuthenticated(channel) };
  }

  root.SaMiniP2PPairing = { attachPairing, attachTrusted };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SaMiniP2PPairing;
})(typeof window !== 'undefined' ? window : globalThis);
