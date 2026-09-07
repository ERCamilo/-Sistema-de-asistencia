import { state } from '../../core/AppState.js';
import { getEntityScope } from '../projects/ProjectContext.js';
import {
  buildSaMiniRosterPayload,
  resolveSaMiniRosterScope,
  selectSaMiniRosterEmployees
} from '../export/SaMiniRosterExport.js';

const MINI_PAIR_BASE_URL = 'https://miniasist.erlin.do/';
const MODAL_ID = 'sa-p2p-roster-modal';
const store = () => window.SaMiniP2P.makeIdentityStore('sa', 'SA - Oficina');
let activeSession = null;
let activeChannel = null;
let activePeer = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function notify(message, type = 'info') {
  if (window.showNotification) window.showNotification(message, type);
}

function modal() { return document.getElementById(MODAL_ID); }
function body() { return modal()?.querySelector('[data-p2p-body]'); }

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
  const peers = (await store().listPeers()).filter(p => p.peerApp === 'mini');
  const peerRows = peers.length ? peers.map(peer => `
    <div style="display:flex;gap:10px;align-items:center;border:1px solid rgba(148,163,184,.28);border-radius:12px;padding:12px">
      <div style="flex:1;min-width:0"><strong>${esc(peer.displayName)}</strong><div style="font-size:11px;opacity:.65;overflow:hidden;text-overflow:ellipsis">Vinculado ${esc(new Date(peer.linkedAt).toLocaleString('es-DO'))}</div></div>
      <button type="button" data-send-peer="${esc(peer.peerId)}" style="border:0;border-radius:10px;padding:9px 12px;background:#16a34a;color:#fff;font-weight:700;cursor:pointer">Enviar roster</button>
      <button type="button" data-unlink-peer="${esc(peer.peerId)}" title="Desvincular" style="border:1px solid rgba(239,68,68,.35);border-radius:10px;padding:9px 10px;background:transparent;color:#dc2626;cursor:pointer">×</button>
    </div>`).join('') : '<div style="font-size:13px;opacity:.7;padding:8px 0">Aún no hay Mini vinculados.</div>';
  body().innerHTML = `
    <div style="display:grid;gap:12px">
      <div style="border:1px solid rgba(37,99,235,.28);border-radius:14px;padding:14px;background:rgba(37,99,235,.07)"><strong>👥 Personal / Roster</strong><div style="font-size:12px;margin-top:4px">Disponible ahora · SA → Mini</div></div>
      ${disabledCard('🕒 Asistencia','Mini → SA')}
      ${disabledCard('💾 Backup','SA ↔ SA / Mini ↔ Mini')}
      ${disabledCard('📄 Documentos / Archivos','Reservado para una fase futura')}
    </div>
    <div style="margin-top:18px;display:flex;justify-content:space-between;align-items:center;gap:10px"><strong>Dispositivos vinculados</strong><span style="font-size:11px;opacity:.6">Este SA: ${esc(self.displayName)}</span></div>
    <div style="display:grid;gap:8px;margin-top:10px">${peerRows}</div>
    <div style="margin-top:16px">${button('Vincular Mini · QR o código','data-new-pair aria-label="Vincular un nuevo Mini con QR o código de 6 dígitos"')}</div>
    <p style="font-size:11px;line-height:1.45;opacity:.65;margin:12px 2px 0">Escanea un QR o usa el código de 6 dígitos y la clave para vincular Mini. Vincular un dispositivo no importa ni modifica datos automáticamente; cada roster recibido todavía requiere revisión y confirmación en Mini.</p>`;
  body().querySelector('[data-new-pair]').addEventListener('click', startNewPairing);
  body().querySelectorAll('[data-send-peer]').forEach(btn => btn.addEventListener('click', () => connectTrustedAndSend(btn.dataset.sendPeer)));
  body().querySelectorAll('[data-unlink-peer]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('¿Desvincular este Mini? Tendrá que volver a emparejarse para recibir transferencias.')) return;
    await store().removePeer(btn.dataset.unlinkPeer);
    renderHome();
  }));
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

function renderPairLinked(peer, channel) {
  activePeer = peer;
  body().innerHTML = `<h3 style="margin-top:0">✓ Mini vinculado</h3><p><strong>${esc(peer.displayName)}</strong> quedó reconocido por este SA.</p><label style="display:flex;gap:8px;align-items:center;margin:14px 0"><input type="checkbox" data-salary> Incluir sueldo en este roster</label>${button('Enviar roster ahora','data-send-now')}<button type="button" data-done style="width:100%;margin-top:8px;border:0;background:transparent;padding:10px;color:inherit;cursor:pointer">Terminar</button><div data-send-status style="font-size:12px;margin-top:10px"></div>`;
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
    const identityStore = store();
    const self = await identityStore.getSelf();
    const peer = await identityStore.getPeer(peerId);
    if (!peer || peer.peerApp !== 'mini') throw new Error('Mini vinculado no encontrado.');
    activePeer = peer;
    body().innerHTML = `<button type="button" data-back style="border:0;background:transparent;color:inherit;cursor:pointer;padding:0 0 12px">← Volver</button><h3 style="margin:0 0 8px">Enviar roster a ${esc(peer.displayName)}</h3><p style="font-size:13px;opacity:.7">En Mini abre Transferencias → Personal / Roster → Esperar roster.</p><label style="display:flex;gap:8px;align-items:center;margin:14px 0"><input type="checkbox" data-salary> Incluir sueldo en esta transferencia</label><div data-connect-status style="padding:12px;border-radius:12px;background:rgba(59,130,246,.08);font-size:13px">Buscando el Mini vinculado…</div>`;
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
            if (box) box.innerHTML = `✓ ${esc(peer.displayName)} autenticado.${button('Enviar roster','data-trusted-send')}`;
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
    if (status) status.innerHTML = `<strong style="color:#16a34a">✓ Roster recibido y validado por ${esc(peer.displayName)}</strong><br><span style="font-size:11px">Mini todavía debe revisarlo y confirmar la importación.</span>`;
    notify(`✅ Roster enviado a ${peer.displayName}`, 'success');
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
}
