import { state } from '../../core/AppState.js';
import { getEntityScope } from '../projects/ProjectContext.js';
import { p2pPeerAliasStore } from './P2PPeerAliasStore.js';
import {
  buildSaMiniRosterPayload,
  resolveSaMiniRosterScope,
  selectSaMiniRosterEmployees
} from '../export/SaMiniRosterExport.js';

const MINI_PAIR_BASE_URL = 'https://miniasist.erlin.do/';
const MODAL_ID = 'sa-p2p-roster-modal';
const store = () => window.SaMiniP2P.makeIdentityStore('sa', 'SA - Oficina');
const aliasStore = p2pPeerAliasStore;
let activeSession = null;
let activeChannel = null;
let activePeer = null;
let projectSetupListenerAttached = false;

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function notify(message, type = 'info') {
  if (window.showNotification) window.showNotification(message, type);
}

function peerName(peer) {
  return aliasStore.resolveName(peer);
}

function peerOriginalName(peer) {
  const original = String(peer?.displayName || '').trim();
  return original || (peer?.peerApp === 'mini' ? 'Mini' : peer?.peerApp === 'sa' ? 'SA' : 'Dispositivo');
}

function peerActivityMs(peer) {
  const parsed = Date.parse(peer?.lastSeenAt || peer?.linkedAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortPeersByRecentActivity(peers = []) {
  return [...peers].sort((a, b) => peerActivityMs(b) - peerActivityMs(a) || String(a?.peerId || '').localeCompare(String(b?.peerId || '')));
}

function formatPeerDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date.toLocaleString('es-DO') : 'Sin registro';
}

function modal() { return document.getElementById(MODAL_ID); }
function body() { return modal()?.querySelector('[data-p2p-body]'); }

async function getProjectSetupState() {
  if (typeof window.getProjectSetupState !== 'function') {
    return { enabled: false, ready: false, activeProjectId: null, activeProject: null };
  }
  return window.getProjectSetupState();
}

function cleanupSession() {
  try { activeSession?.close?.(); } catch (_) {}
  activeSession = null;
  activeChannel = null;
  activePeer = null;
}

export function closeP2PRosterTransfer() {
  cleanupSession();
  modal()?.remove();
}

function shell() {
  if (modal()) return;
  const el = document.createElement('div');
  el.id = MODAL_ID;
  el.className = 'modal-overlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:16px;';
  el.innerHTML = `
    <section role="dialog" aria-modal="true" aria-labelledby="sa-p2p-title" style="width:min(680px,100%);max-height:92vh;overflow:auto;background:var(--card-bg,#fff);color:var(--text-color,#111827);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.28);">
      <header style="display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid rgba(148,163,184,.28);position:sticky;top:0;background:inherit;z-index:2;">
        <div style="font-size:24px">⇄</div>
        <div style="flex:1"><strong id="sa-p2p-title" style="font-size:18px">Transferencias directas</strong><div style="font-size:12px;opacity:.7">SA ↔ Mini · WebRTC</div></div>
        <button type="button" data-p2p-close aria-label="Cerrar" style="border:0;background:transparent;font-size:28px;cursor:pointer;color:inherit">×</button>
      </header>
      <div data-p2p-body style="padding:18px 20px"></div>
    </section>`;
  el.querySelector('[data-p2p-close]').addEventListener('click', closeP2PRosterTransfer);
  el.addEventListener('click', e => { if (e.target === el) closeP2PRosterTransfer(); });
  document.body.appendChild(el);
}

function button(label, attrs = '') {
  return `<button type="button" ${attrs} style="width:100%;border:0;border-radius:12px;padding:12px 14px;font-weight:700;cursor:pointer;background:#2563eb;color:#fff">${label}</button>`;
}

function disabledCard(title, detail) {
  return `<div aria-disabled="true" style="border:1px solid rgba(148,163,184,.3);border-radius:14px;padding:14px;opacity:.48;background:rgba(148,163,184,.08)"><strong>${title}</strong><div style="font-size:12px;margin-top:4px">${detail} · Próximamente</div></div>`;
}

async function buildRosterText(includeSalary = false) {
  const scope = await getEntityScope();
  const saProjectId = resolveSaMiniRosterScope(scope);
  const inScope = selectSaMiniRosterEmployees(state.employees, scope);
  const payload = buildSaMiniRosterPayload({
    saProjectId,
    employees: inScope,
    positions: state.positions,
    settings: state.settings,
    includeSalary: includeSalary === true,
    scope
  });
  return { payload, text: JSON.stringify(payload, null, 2) };
}

async function renderHome() {
  shell();
  cleanupSession();
  const self = await store().getSelf();
  const peers = sortPeersByRecentActivity((await store().listPeers()).filter(p => p.peerApp === 'mini'));
  let projectState;
  try { projectState = await getProjectSetupState(); }
  catch (error) { projectState = { enabled: true, ready: false, activeProject: null, error }; }
  const projectCard = projectState.ready
    ? `<div style="border:1px solid rgba(22,163,74,.32);border-radius:14px;padding:13px;background:rgba(22,163,74,.07)"><div style="font-size:11px;opacity:.65">Proyecto a enviar</div><strong>${esc(projectState.activeProject?.name || projectState.activeProjectId)}</strong><div style="font-size:10px;opacity:.58;margin-top:3px;font-family:monospace;word-break:break-all">${esc(projectState.activeProjectId)}</div><button type="button" data-configure-project style="margin-top:9px;border:0;background:transparent;color:#2563eb;font-weight:700;cursor:pointer;padding:0">Configurar proyecto</button></div>`
    : `<div style="border:1px solid rgba(245,158,11,.38);border-radius:14px;padding:13px;background:rgba(245,158,11,.08)"><strong>Se necesita un proyecto activo</strong><div style="font-size:12px;margin-top:4px;line-height:1.45">Mini puede vincularse sin proyecto, pero SA no enviará empleados hasta resolver un projectId oficial.</div><button type="button" data-configure-project style="margin-top:9px;border:0;background:transparent;color:#2563eb;font-weight:700;cursor:pointer;padding:0">Configurar proyecto</button></div>`;
  const peerRows = peers.length ? peers.map(peer => {
    const alias = aliasStore.getAlias(peer.peerId);
    const original = peerOriginalName(peer);
    const linked = formatPeerDate(peer.linkedAt);
    const lastSeen = formatPeerDate(peer.lastSeenAt || peer.linkedAt);
    const originalLine = alias ? `<div style="font-size:11px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Original: ${esc(original)}</div>` : '';
    return `
    <div style="display:flex;gap:10px;align-items:center;border:1px solid rgba(148,163,184,.28);border-radius:12px;padding:12px">
      <div style="flex:1;min-width:0"><strong>${esc(peerName(peer))}</strong>${originalLine}<div style="font-size:11px;opacity:.65;line-height:1.35">Última conexión: ${esc(lastSeen)} · Vinculado: ${esc(linked)}</div></div>
      <button type="button" data-rename-peer="${esc(peer.peerId)}" aria-label="Cambiar nombre de ${esc(peerName(peer))}" title="Cambiar nombre" style="border:1px solid rgba(37,99,235,.28);border-radius:10px;padding:9px 10px;background:transparent;color:#2563eb;cursor:pointer">✎</button>
      <button type="button" data-send-peer="${esc(peer.peerId)}" ${projectState.ready ? '' : 'disabled aria-disabled="true" title="Configura un proyecto antes de enviar"'} style="border:0;border-radius:10px;padding:9px 12px;background:${projectState.ready ? '#16a34a' : '#94a3b8'};color:#fff;font-weight:700;cursor:${projectState.ready ? 'pointer' : 'not-allowed'}">Enviar roster</button>
      <button type="button" data-unlink-peer="${esc(peer.peerId)}" title="Desvincular" style="border:1px solid rgba(239,68,68,.35);border-radius:10px;padding:9px 10px;background:transparent;color:#dc2626;cursor:pointer">×</button>
    </div>`;
  }).join('') : '<div style="font-size:13px;opacity:.7;padding:8px 0">Aún no hay Mini vinculados.</div>';
  body().innerHTML = `
    <div style="display:grid;gap:12px">
      <div style="border:1px solid rgba(37,99,235,.28);border-radius:14px;padding:14px;background:rgba(37,99,235,.07)"><strong>👥 Personal / Roster</strong><div style="font-size:12px;margin-top:4px">Disponible ahora · SA → Mini</div></div>
      ${projectCard}
      ${disabledCard('🕒 Asistencia','Mini → SA')}
      ${disabledCard('💾 Backup','SA ↔ SA / Mini ↔ Mini')}
      ${disabledCard('📄 Documentos / Archivos','Reservado para una fase futura')}
    </div>
    <div style="margin-top:18px;display:flex;justify-content:space-between;align-items:center;gap:10px"><strong>Dispositivos vinculados</strong><span style="font-size:11px;opacity:.72;display:flex;align-items:center;gap:5px">Este SA: <strong>${esc(self.displayName)}</strong><button type="button" data-rename-self aria-label="Cambiar nombre de este SA" title="Cambiar nombre de este SA" style="border:0;background:transparent;color:#2563eb;cursor:pointer;padding:2px 4px;font-size:13px">✎</button></span></div>
    <div style="display:grid;gap:8px;margin-top:10px">${peerRows}</div>
    <div style="margin-top:16px">${button('Vincular Mini · QR o código','data-new-pair aria-label="Vincular un nuevo Mini con QR o código de 6 dígitos"')}</div>
    <p style="font-size:11px;line-height:1.45;opacity:.65;margin:12px 2px 0">Escanea un QR o usa el código de 6 dígitos y la clave para vincular Mini. Vincular un dispositivo no importa ni modifica datos automáticamente; cada roster recibido todavía requiere revisión y confirmación en Mini.</p>`;
  body().querySelector('[data-configure-project]')?.addEventListener('click', () => window.openProjectSetupModal?.());
  body().querySelector('[data-new-pair]').addEventListener('click', startNewPairing);
  body().querySelector('[data-rename-self]')?.addEventListener('click', renderSelfNameEditor);
  body().querySelectorAll('[data-rename-peer]').forEach(btn => btn.addEventListener('click', () => renderPeerAliasEditor(btn.dataset.renamePeer)));
  body().querySelectorAll('[data-send-peer]').forEach(btn => btn.addEventListener('click', () => connectTrustedAndSend(btn.dataset.sendPeer)));
  body().querySelectorAll('[data-unlink-peer]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('¿Desvincular este Mini? Tendrá que volver a emparejarse para recibir transferencias.')) return;
    const peerId = btn.dataset.unlinkPeer;
    await store().removePeer(peerId);
    aliasStore.removeAlias(peerId);
    renderHome();
  }));
}

async function renderSelfNameEditor() {
  const identityStore = store();
  const self = await identityStore.getSelf();
  body().innerHTML = `
    <button type="button" data-back style="border:0;background:transparent;color:inherit;cursor:pointer;padding:0 0 12px">← Volver</button>
    <h3 style="margin:0 0 6px">Nombre de este SA</h3>
    <p style="font-size:13px;opacity:.7;margin:0 0 14px">Este es el nombre que este dispositivo presenta en futuros emparejamientos.</p>
    <label for="sa-p2p-self-name" style="display:block;font-size:12px;margin-bottom:5px">Nombre del dispositivo</label>
    <input id="sa-p2p-self-name" data-self-name maxlength="80" value="${esc(self.displayName)}" placeholder="Ej: SA oficina" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid rgba(148,163,184,.45);border-radius:10px;background:inherit;color:inherit">
    <p style="font-size:11px;line-height:1.45;opacity:.65">Cambiarlo no modifica deviceId, claves ni vínculos existentes. Los aliases personalizados guardados en otros dispositivos tampoco cambian.</p>
    <div style="margin-top:14px">${button('Guardar nombre del SA','data-save-self-name')}</div>`;
  const input = body().querySelector('[data-self-name]');
  input?.focus();
  input?.select();
  body().querySelector('[data-back]').addEventListener('click', renderHome);
  body().querySelector('[data-save-self-name]').addEventListener('click', async () => {
    const nextName = String(input.value || '').trim();
    if (!nextName) {
      notify('Escribe un nombre para este SA.', 'warning');
      return;
    }
    await identityStore.renameSelf(nextName);
    renderHome();
  });
}

async function renderPeerAliasEditor(peerId) {
  const peer = await store().getPeer(peerId);
  if (!peer || peer.peerApp !== 'mini') {
    notify('No se encontró el Mini vinculado.', 'error');
    return renderHome();
  }
  const currentAlias = aliasStore.getAlias(peer.peerId);
  const original = peerOriginalName(peer);
  body().innerHTML = `
    <button type="button" data-back style="border:0;background:transparent;color:inherit;cursor:pointer;padding:0 0 12px">← Volver</button>
    <h3 style="margin:0 0 6px">Nombre de esta conexión</h3>
    <p style="font-size:13px;opacity:.7;margin:0 0 14px">Nombre original: <strong>${esc(original)}</strong></p>
    <label for="sa-p2p-peer-alias" style="display:block;font-size:12px;margin-bottom:5px">Nombre personalizado</label>
    <input id="sa-p2p-peer-alias" data-peer-alias maxlength="64" value="${esc(currentAlias)}" placeholder="Ej: Mini de Juan" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid rgba(148,163,184,.45);border-radius:10px;background:inherit;color:inherit">
    <p style="font-size:11px;line-height:1.45;opacity:.65">Este nombre se guarda sólo en este SA. No cambia el vínculo, la identidad del dispositivo ni sus claves de seguridad.</p>
    <div style="display:grid;gap:8px;margin-top:14px">
      ${button('Guardar nombre','data-save-alias')}
      <button type="button" data-clear-alias style="width:100%;border:1px solid rgba(148,163,184,.4);border-radius:12px;padding:11px 14px;background:transparent;color:inherit;font-weight:700;cursor:pointer">Usar nombre original</button>
    </div>`;
  const input = body().querySelector('[data-peer-alias]');
  input?.focus();
  input?.select();
  body().querySelector('[data-back]').addEventListener('click', renderHome);
  body().querySelector('[data-save-alias]').addEventListener('click', () => {
    aliasStore.setAlias(peer.peerId, input.value);
    renderHome();
  });
  body().querySelector('[data-clear-alias]').addEventListener('click', () => {
    aliasStore.removeAlias(peer.peerId);
    renderHome();
  });
}

export function renderQr(url) {
  try {
    if (typeof window.qrcode !== 'function') return '<div style="font-size:12px;color:#b45309">QR no disponible. Usa código + clave.</div>';
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const dataUrl = qr.createDataURL(4, 2);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) throw new Error('QR data URL inválida.');
    return `<div style="background:#fff;padding:10px;border-radius:12px;display:inline-block"><img src="${esc(dataUrl)}" width="240" height="240" alt="Código QR de vinculación SA con Mini" style="display:block;width:min(100%,240px);max-width:100%;height:auto;aspect-ratio:1 / 1;image-rendering:pixelated"></div>`;
  } catch (_) {
    return '<div style="font-size:12px;color:#b45309">No se pudo generar QR. Usa código + clave.</div>';
  }
}

async function startNewPairing() {
  cleanupSession();
  try {
    const identityStore = store();
    const self = await identityStore.getSelf();
    const descriptor = await window.SaMiniP2P.makePairDescriptor(self);
    const pairUrl = window.SaMiniP2P.buildPairUrl(descriptor, MINI_PAIR_BASE_URL);
    body().innerHTML = `
      <button type="button" data-back style="border:0;background:transparent;color:inherit;cursor:pointer;padding:0 0 12px">← Volver</button>
      <h3 style="margin:0 0 6px">Vincular nuevo Mini</h3>
      <p style="font-size:13px;opacity:.72;margin:0 0 16px">En Mini, escanea este QR o abre Transferencias e introduce el código de 6 dígitos y la clave.</p>
      <div style="display:grid;grid-template-columns:minmax(180px,240px) 1fr;gap:18px;align-items:center">
        <div style="text-align:center"><div style="font-size:12px;font-weight:700;margin-bottom:6px">QR de vinculación</div>${renderQr(pairUrl)}</div>
        <div>
          <div style="font-size:12px;opacity:.65">Código de 6 dígitos</div><div style="font-size:30px;font-weight:800;letter-spacing:4px">${esc(descriptor.code.slice(0,3)+' '+descriptor.code.slice(3))}</div>
          <div style="font-size:12px;opacity:.65;margin-top:12px">Clave</div><div style="font-size:22px;font-weight:800;letter-spacing:2px">${esc(descriptor.key)}</div>
          <div style="font-size:12px;opacity:.65;margin-top:14px">Expira en 5 minutos. El código solo no basta para entrar.</div>
        </div>
      </div>
      <div data-pair-status style="margin-top:16px;padding:12px;border-radius:12px;background:rgba(59,130,246,.08);font-size:13px">Esperando a Mini…</div>`;
    body().querySelector('[data-back]').addEventListener('click', renderHome);
    const signaling = new window.SaMiniP2P.SignalingClient({ room: descriptor.room, peerId: self.deviceId, proof: descriptor.proof, expiresAt: descriptor.expiresAt });
    activeSession = await window.SaMiniP2P.createRtcSession({
      signaling,
      initiator: true,
      onState: (status, error) => {
        const box = body()?.querySelector('[data-pair-status]');
        if (box && error) box.textContent = 'Error: ' + error.message;
      },
      onChannel: channel => {
        activeChannel = channel;
        window.SaMiniP2PPairing.attachPairing(channel, {
          self, descriptor, initiator: true, store: identityStore,
          onCandidate: ({ remote, sas, accept, reject }) => renderPairConfirmation(remote, sas, accept, reject),
          onLinked: peer => renderPairLinked(peer, channel),
          onRejected: () => renderPairError('Mini rechazó el vínculo.'),
          onError: renderPairError
        });
      }
    });
  } catch (error) { renderPairError(error); }
}

function renderPairConfirmation(remote, sas, accept, reject) {
  const box = body()?.querySelector('[data-pair-status]');
  if (!box) return;
  box.innerHTML = `<strong>${esc(remote.displayName)}</strong> quiere vincularse.<br><span style="font-size:12px">Confirma que ambos dispositivos muestran:</span><div style="font-size:28px;font-weight:800;letter-spacing:4px;margin:8px 0">${esc(sas)}</div><div style="display:flex;gap:8px"><button data-reject style="flex:1;padding:10px;border-radius:10px;border:1px solid #ef4444;background:transparent;color:#dc2626">Rechazar</button><button data-accept style="flex:1;padding:10px;border-radius:10px;border:0;background:#16a34a;color:#fff;font-weight:700">Confirmar vínculo</button></div>`;
  box.querySelector('[data-accept]').addEventListener('click', async () => { box.textContent='Esperando confirmación de Mini…'; await accept(); });
  box.querySelector('[data-reject]').addEventListener('click', reject);
}

async function renderPairLinked(peer, channel) {
  activePeer = peer;
  let projectState;
  try { projectState = await getProjectSetupState(); }
  catch (error) { projectState = { ready: false, error }; }
  if (!projectState.ready) {
    body().innerHTML = `<h3 style="margin-top:0">✓ Mini vinculado</h3><p><strong>${esc(peerName(peer))}</strong> quedó reconocido por este SA.</p><div style="padding:12px;border-radius:12px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.35);font-size:13px">El vínculo está listo. Para enviar empleados, configura primero el proyecto oficial.</div><div style="margin-top:12px">${button('Configurar proyecto','data-configure-project')}</div><button type="button" data-done style="width:100%;margin-top:8px;border:0;background:transparent;padding:10px;color:inherit;cursor:pointer">Terminar</button>`;
    body().querySelector('[data-configure-project]').addEventListener('click', () => window.openProjectSetupModal?.());
    body().querySelector('[data-done]').addEventListener('click', renderHome);
    return;
  }
  body().innerHTML = `<h3 style="margin-top:0">✓ Mini vinculado</h3><p><strong>${esc(peerName(peer))}</strong> quedó reconocido por este SA.</p><div style="font-size:12px;padding:10px;border-radius:10px;background:rgba(22,163,74,.07);margin-bottom:12px">Proyecto: <strong>${esc(projectState.activeProject?.name || projectState.activeProjectId)}</strong></div><label style="display:flex;gap:8px;align-items:center;margin:14px 0"><input type="checkbox" data-salary> Incluir sueldo en este roster</label>${button('Enviar roster ahora','data-send-now')}<button type="button" data-done style="width:100%;margin-top:8px;border:0;background:transparent;padding:10px;color:inherit;cursor:pointer">Terminar</button><div data-send-status style="font-size:12px;margin-top:10px"></div>`;
  body().querySelector('[data-send-now]').addEventListener('click', () => sendRosterOnChannel(channel, peer, body().querySelector('[data-salary]').checked));
  body().querySelector('[data-done]').addEventListener('click', renderHome);
}

function renderPairError(error) {
  const message = error?.message || String(error || 'Error P2P');
  const box = body()?.querySelector('[data-pair-status]');
  if (box) box.innerHTML = `<strong style="color:#dc2626">No se pudo completar:</strong> ${esc(message)}`;
  else notify('❌ ' + message, 'error');
}

async function connectTrustedAndSend(peerId) {
  cleanupSession();
  try {
    const projectState = await getProjectSetupState();
    if (!projectState.ready) {
      notify('⚠️ Configura un proyecto activo antes de enviar el roster.', 'warning');
      await window.openProjectSetupModal?.();
      return;
    }
    const identityStore = store();
    const self = await identityStore.getSelf();
    const peer = await identityStore.getPeer(peerId);
    if (!peer || peer.peerApp !== 'mini') throw new Error('Mini vinculado no encontrado.');
    activePeer = peer;
    body().innerHTML = `<button type="button" data-back style="border:0;background:transparent;color:inherit;cursor:pointer;padding:0 0 12px">← Volver</button><h3 style="margin:0 0 8px">Enviar roster a ${esc(peerName(peer))}</h3><p style="font-size:13px;opacity:.7">Proyecto: <strong>${esc(projectState.activeProject?.name || projectState.activeProjectId)}</strong>. En Mini abre Transferencias → Personal / Roster → Esperar roster.</p><label style="display:flex;gap:8px;align-items:center;margin:14px 0"><input type="checkbox" data-salary> Incluir sueldo en esta transferencia</label><div data-connect-status style="padding:12px;border-radius:12px;background:rgba(59,130,246,.08);font-size:13px">Buscando el Mini vinculado…</div>`;
    body().querySelector('[data-back]').addEventListener('click', renderHome);
    const route = await window.SaMiniP2P.deriveTrustedRoute(peer.linkToken);
    const signaling = new window.SaMiniP2P.SignalingClient({ room: route.room, peerId: self.deviceId, proof: route.proof });
    activeSession = await window.SaMiniP2P.createRtcSession({
      signaling, initiator: true,
      onState: (status, error) => { const box=body()?.querySelector('[data-connect-status]'); if(box && error) box.textContent='Error: '+error.message; },
      onChannel: channel => {
        activeChannel = channel;
        window.SaMiniP2PPairing.attachTrusted(channel, {
          self, peer, store: identityStore,
          onAuthenticated: () => {
            const box=body()?.querySelector('[data-connect-status]');
            if (box) box.innerHTML = `✓ ${esc(peerName(peer))} autenticado.${button('Enviar roster','data-trusted-send')}`;
            box?.querySelector('[data-trusted-send]')?.addEventListener('click', () => sendRosterOnChannel(channel, peer, body().querySelector('[data-salary]').checked));
          },
          onError: error => { const box=body()?.querySelector('[data-connect-status]'); if(box) box.textContent='Autenticación falló: '+error.message; }
        });
      }
    });
  } catch (error) { notify('❌ '+(error.message || error),'error'); renderHome(); }
}

function waitForRosterStageAck(channel, transfer, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.removeEventListener('message', handler);
      fn(value);
    };
    const handler = event => {
       let msg;
       try { msg = window.SaMiniP2P.parseControl(event.data); }
       catch (error) { finish(reject, error); return; }
       if (!msg || !['roster-staged','roster-rejected'].includes(msg.type)) return;
       if (String(msg.data?.transferId || '') !== transfer.transferId) return;
       if (msg.type === 'roster-rejected') {
         try {
           const rejection = window.SaMiniP2P.validateRosterRejected(msg.data, transfer);
           finish(reject, new Error(`Mini rechazó el roster durante la validación: ${rejection.reason}`));
         } catch (error) { finish(reject, error); }
         return;
       }
       try { finish(resolve, window.SaMiniP2P.validateRosterStageAck(msg.data, transfer)); }
       catch (error) { finish(reject, error); }
    };
    const timer = setTimeout(() => finish(reject, new Error('Mini no confirmó la recepción validada del roster a tiempo.')), timeoutMs);
    channel.addEventListener('message', handler);
  });
}

async function sendRosterOnChannel(channel, peer, includeSalary) {
  const status = body()?.querySelector('[data-send-status]') || body()?.querySelector('[data-connect-status]');
  try {
    const { payload, text } = await buildRosterText(includeSalary);
    if (status) status.textContent = `Preparando ${payload.employees.length} empleados…`;
    const transfer = await window.SaMiniP2P.sendPayload(channel, {
      kind: 'roster', schema: 'sa-roster/v1', text,
      onProgress: progress => { if (status) status.textContent = `Enviando… ${Math.round(progress*100)}%`; }
    });
    if (status) status.textContent = 'Bytes enviados. Esperando validación de Mini…';
    await waitForRosterStageAck(channel, transfer);
    if (status) status.innerHTML = `<strong style="color:#16a34a">✓ Roster recibido y validado por ${esc(peerName(peer))}</strong><br><span style="font-size:11px">Mini todavía debe revisarlo y confirmar la importación.</span>`;
    notify('✅ Roster enviado y validado por Mini', 'success');
  } catch (error) {
    if (status) status.innerHTML = `<strong style="color:#dc2626">Error:</strong> ${esc(error.message || error)}`;
  }
}

export async function openP2PRosterTransfer() {
  try {
    window.closeExportMenu?.();
    await renderHome();
  } catch (error) { notify('❌ '+(error.message || error),'error'); }
}

export function registerP2PRosterGlobals() {
  window.openP2PRosterTransfer = openP2PRosterTransfer;
  window.closeP2PRosterTransfer = closeP2PRosterTransfer;
  if (!projectSetupListenerAttached) {
    window.addEventListener('projects:setup-changed', () => {
      if (modal()) renderHome().catch(error => notify('❌ ' + (error.message || error), 'error'));
    });
    projectSetupListenerAttached = true;
  }
}
