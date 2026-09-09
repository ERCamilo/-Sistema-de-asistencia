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
let activeMorphCleanup = null;

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

function prefersReducedMotion() {
  try { return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches); }
  catch (_) { return false; }
}

function setBodyHtml(markup) {
  if (activeMorphCleanup) activeMorphCleanup();
  const target = body();
  const panel = modal()?.querySelector('.sa-p2p-shell');
  if (!target) return;
  if (!panel || prefersReducedMotion() || typeof panel.getBoundingClientRect !== 'function') {
    target.innerHTML = markup;
    return;
  }
  const from = Math.round(panel.getBoundingClientRect().height || 0);
  if (!(from > 0)) { target.innerHTML = markup; return; }
  panel.style.height = `${from}px`;
  panel.style.transition = 'none';
  target.innerHTML = markup;
  const maxHeight = Math.round(window.innerHeight * 0.9);
  const to = Math.min(Math.max(panel.scrollHeight, 1), maxHeight || panel.scrollHeight);
  requestAnimationFrame(() => {
    panel.style.transition = 'height 260ms cubic-bezier(.2,.8,.2,1)';
    panel.style.height = `${to}px`;
    let timer = null;
    const cleanup = () => {
      panel.removeEventListener('transitionend', cleanup);
      if (timer) clearTimeout(timer);
      if (activeMorphCleanup === cleanup) activeMorphCleanup = null;
      panel.style.height = '';
      panel.style.transition = '';
    };
    activeMorphCleanup = cleanup;
    panel.addEventListener('transitionend', cleanup, { once: true });
    timer = setTimeout(cleanup, 340);
  });
}

async function getProjectSetupState() {
  if (typeof window.getProjectSetupState !== 'function') {
    return { enabled: false, ready: false, activeProjectId: null, activeProject: null };
  }
  return window.getProjectSetupState();
}

function cleanupSession() {
  if (activeMorphCleanup) activeMorphCleanup();
  try { activeSession?.close?.(); } catch (_) {}
  activeSession = null;
  activeChannel = null;
  activePeer = null;
}

export function closeP2PRosterTransfer() {
  cleanupSession();
  modal()?.remove();
}

const P2P_ICONS = {
  transfer: '<path d="M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3 3m-3-3 3-3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  project: '<path d="M3 7h18v13H3z"/><path d="M8 7V4h8v3"/>',
  attendance: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  files: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  mini: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 18h6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  unlink: '<path d="m18 13 3-3-3-3"/><path d="M21 10h-8"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 18l-6-6 6-6"/>'
};

function p2pIcon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P2P_ICONS[name] || P2P_ICONS.transfer}</svg>`;
}

function shell() {
  if (modal()) return;
  const el = document.createElement('div');
  el.id = MODAL_ID;
  el.className = 'modal-overlay sa-p2p-overlay';
  el.innerHTML = `
    <section class="sa-p2p-shell" role="dialog" aria-modal="true" aria-labelledby="sa-p2p-title">
      <header class="sa-p2p-topbar">
        <div class="sa-p2p-topbar-icon">${p2pIcon('transfer', 20)}</div>
        <div class="sa-p2p-title-wrap"><strong id="sa-p2p-title" class="sa-p2p-title">Transferencias directas</strong><div class="sa-p2p-subtitle">SA ↔ Mini · conexión directa</div></div>
        <button type="button" class="sa-p2p-icon-btn" data-p2p-close aria-label="Cerrar" title="Cerrar">${p2pIcon('close', 17)}</button>
      </header>
      <div class="sa-p2p-body" data-p2p-body></div>
    </section>`;
  el.querySelector('[data-p2p-close]').addEventListener('click', closeP2PRosterTransfer);
  el.addEventListener('click', e => { if (e.target === el) closeP2PRosterTransfer(); });
  document.body.appendChild(el);
}

function button(label, attrs = '', kind = 'primary', iconName = '') {
  const iconMarkup = iconName ? p2pIcon(iconName, 16) : '';
  return `<button type="button" class="sa-p2p-button sa-p2p-button-${kind}" ${attrs}>${iconMarkup}<span>${label}</span></button>`;
}

function backButton(label = 'Volver') {
  return `<button type="button" class="sa-p2p-back" data-back>${p2pIcon('back', 17)}<span>${label}</span></button>`;
}

function askUnlinkConfirmation(name) {
  return new Promise(resolve => {
    if (typeof window.showConfirm !== 'function') {
      notify('No se pudo abrir la confirmación para desvincular.', 'error');
      resolve(false);
      return;
    }
    window.showConfirm({
      title: 'Desvincular Mini',
      message: `${name} tendrá que volver a emparejarse para recibir transferencias.`,
      confirmText: 'Desvincular',
      cancelText: 'Cancelar',
      type: 'danger',
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false)
    });
  });
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

  const capability = (iconName, title, detail, stateClass = '') => `
    <div class="sa-p2p-capability ${stateClass}">
      <span class="sa-p2p-capability-icon">${p2pIcon(iconName, 17)}</span>
      <span class="sa-p2p-capability-copy"><strong>${title}</strong><small>${detail}</small></span>
    </div>`;

  const projectCapability = `
    <button type="button" data-configure-project class="sa-p2p-capability ${projectState.ready ? 'is-ready' : 'is-warning'}" aria-label="${projectState.ready ? 'Proyecto activo: ' + esc(projectState.activeProject?.name || projectState.activeProjectId) : 'Configurar proyecto activo'}">
      <span class="sa-p2p-capability-icon">${p2pIcon('project', 17)}</span>
      <span class="sa-p2p-capability-copy"><strong>Proyecto</strong><small>${projectState.ready ? esc(projectState.activeProject?.name || 'Activo') : 'Configurar'}</small></span>
    </button>`;

  const peerRows = peers.length ? peers.map(peer => {
    const alias = aliasStore.getAlias(peer.peerId);
    const original = peerOriginalName(peer);
    const lastSeen = formatPeerDate(peer.lastSeenAt || peer.linkedAt);
    const originalLine = alias ? ` · Original: ${esc(original)}` : '';
    return `
      <div class="sa-p2p-peer-row">
        <div class="sa-p2p-peer-avatar">${p2pIcon('mini', 17)}</div>
        <div class="sa-p2p-peer-copy">
          <strong>${esc(peerName(peer))}</strong>
          <div class="sa-p2p-peer-meta">Última conexión: ${esc(lastSeen)}${originalLine}</div>
        </div>
        <div class="sa-p2p-device-actions">
          <button type="button" class="sa-p2p-icon-btn" data-rename-peer="${esc(peer.peerId)}" aria-label="Cambiar nombre de ${esc(peerName(peer))}" title="Cambiar nombre">${p2pIcon('edit', 16)}</button>
          ${button('Enviar roster', `data-send-peer="${esc(peer.peerId)}" ${projectState.ready ? '' : 'disabled aria-disabled="true" title="Configura un proyecto antes de enviar"'}`, 'primary', 'send')}
          <button type="button" class="sa-p2p-icon-btn" data-unlink-peer="${esc(peer.peerId)}" aria-label="Desvincular ${esc(peerName(peer))}" title="Desvincular">${p2pIcon('unlink', 16)}</button>
        </div>
      </div>`;
  }).join('') : '<div class="sa-p2p-empty">Aún no hay Minis vinculados. Usa el botón Vincular Mini para agregar el primero.</div>';

  setBodyHtml(`
    <section class="sa-p2p-capabilities-wrap" aria-labelledby="sa-p2p-capabilities-title">
      <h3 id="sa-p2p-capabilities-title" class="sa-p2p-section-label">Capacidades</h3>
      <div class="sa-p2p-capabilities">
        ${capability('users', 'Personal', 'SA → Mini', 'is-ready')}
        ${projectCapability}
        ${capability('attendance', 'Asistencia', 'Mini → SA', 'is-ready')}
        ${capability('files', 'Archivos', 'Próximamente', 'is-disabled')}
      </div>
    </section>
    <section class="sa-p2p-devices" aria-labelledby="sa-p2p-devices-title">
      <div class="sa-p2p-devices-head">
        <div><h3 id="sa-p2p-devices-title">Minis vinculados</h3><div class="sa-p2p-subtitle">${peers.length} dispositivo${peers.length === 1 ? '' : 's'} guardado${peers.length === 1 ? '' : 's'} en este SA</div></div>
        <div class="sa-p2p-self">Este SA: <strong>${esc(self.displayName)}</strong><button type="button" class="sa-p2p-icon-btn" data-rename-self aria-label="Cambiar nombre de este SA" title="Cambiar nombre de este SA">${p2pIcon('edit', 15)}</button></div>
      </div>
      <div class="sa-p2p-peer-list">${peerRows}</div>
    </section>
    <div>${button('Vincular Mini', 'data-new-pair aria-label="Vincular un nuevo Mini por QR o código"', 'primary', 'link')}</div>
    <p class="sa-p2p-footnote">Vincular sólo crea una relación segura entre dispositivos. Ningún dato se importa o modifica automáticamente.</p>`);
  body().querySelector('[data-new-pair]').classList.add('sa-p2p-link-cta');
  body().querySelector('[data-configure-project]')?.addEventListener('click', () => window.openProjectSetupModal?.());
  body().querySelector('[data-new-pair]').addEventListener('click', startNewPairing);
  body().querySelector('[data-rename-self]')?.addEventListener('click', renderSelfNameEditor);
  body().querySelectorAll('[data-rename-peer]').forEach(btn => btn.addEventListener('click', () => renderPeerAliasEditor(btn.dataset.renamePeer)));
  body().querySelectorAll('[data-send-peer]').forEach(btn => btn.addEventListener('click', () => connectTrustedAndSend(btn.dataset.sendPeer)));
  body().querySelectorAll('[data-unlink-peer]').forEach(btn => btn.addEventListener('click', async () => {
    const peerId = btn.dataset.unlinkPeer;
    const peer = peers.find(item => String(item.peerId) === String(peerId));
    if (!await askUnlinkConfirmation(peerName(peer || { displayName: 'este Mini', peerApp: 'mini' }))) return;
    await store().removePeer(peerId);
    aliasStore.removeAlias(peerId);
    renderHome();
  }));
}

async function renderSelfNameEditor() {
  const identityStore = store();
  const self = await identityStore.getSelf();
  setBodyHtml(`
    <div class="sa-p2p-step">
      ${backButton()}
      <div><h3>Nombre de este SA</h3><p>Es el nombre que este dispositivo presenta en futuros emparejamientos.</p></div>
      <div class="sa-p2p-field"><label for="sa-p2p-self-name">Nombre del dispositivo</label><input id="sa-p2p-self-name" data-self-name maxlength="80" value="${esc(self.displayName)}" placeholder="Ej: SA oficina"></div>
      <p class="sa-p2p-footnote">Cambiarlo no modifica deviceId, claves ni vínculos existentes. Los aliases guardados en otros dispositivos tampoco cambian.</p>
      <div class="sa-p2p-actions">${button('Guardar nombre', 'data-save-self-name', 'primary')}</div>
    </div>`);
  const input = body().querySelector('[data-self-name]');
  input?.focus(); input?.select();
  body().querySelector('[data-back]').addEventListener('click', renderHome);
  body().querySelector('[data-save-self-name]').addEventListener('click', async () => {
    const nextName = String(input.value || '').trim();
    if (!nextName) { notify('Escribe un nombre para este SA.', 'warning'); return; }
    await identityStore.renameSelf(nextName);
    renderHome();
  });
}

async function renderPeerAliasEditor(peerId) {
  const peer = await store().getPeer(peerId);
  if (!peer || peer.peerApp !== 'mini') { notify('No se encontró el Mini vinculado.', 'error'); return renderHome(); }
  const currentAlias = aliasStore.getAlias(peer.peerId);
  const original = peerOriginalName(peer);
  setBodyHtml(`
    <div class="sa-p2p-step">
      ${backButton()}
      <div><h3>Nombre de esta conexión</h3><p>Nombre original: <strong>${esc(original)}</strong></p></div>
      <div class="sa-p2p-field"><label for="sa-p2p-peer-alias">Nombre personalizado</label><input id="sa-p2p-peer-alias" data-peer-alias maxlength="64" value="${esc(currentAlias)}" placeholder="Ej: Mini de Juan"></div>
      <p class="sa-p2p-footnote">Este nombre se guarda sólo en este SA. No cambia la identidad del dispositivo ni sus claves.</p>
      <div class="sa-p2p-actions">${button('Guardar nombre', 'data-save-alias', 'primary')}${button('Usar nombre original', 'data-clear-alias', 'secondary')}</div>
    </div>`);
  const input = body().querySelector('[data-peer-alias]');
  input?.focus(); input?.select();
  body().querySelector('[data-back]').addEventListener('click', renderHome);
  body().querySelector('[data-save-alias]').addEventListener('click', () => { aliasStore.setAlias(peer.peerId, input.value); renderHome(); });
  body().querySelector('[data-clear-alias]').addEventListener('click', () => { aliasStore.removeAlias(peer.peerId); renderHome(); });
}

export function renderQr(url) {
  try {
    if (typeof window.qrcode !== 'function') return '<div class="sa-p2p-qr-warning">QR no disponible. Usa código + clave.</div>';
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const dataUrl = qr.createDataURL(4, 2);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) throw new Error('QR data URL inválida.');
    return `<div class="sa-p2p-qr-card"><img class="sa-p2p-qr-image" src="${esc(dataUrl)}" width="240" height="240" alt="Código QR de vinculación SA con Mini"></div>`;
  } catch (_) {
    return '<div class="sa-p2p-qr-warning">No se pudo generar QR. Usa código + clave.</div>';
  }
}

async function startNewPairing() {
  cleanupSession();
  try {
    const identityStore = store();
    const self = await identityStore.getSelf();
    const descriptor = await window.SaMiniP2P.makePairDescriptor(self);
    const pairUrl = window.SaMiniP2P.buildPairUrl(descriptor, MINI_PAIR_BASE_URL);
    setBodyHtml(`
      <div class="sa-p2p-step">
        ${backButton()}
        <div><h3>Vincular nuevo Mini</h3><p>En Mini, escanea este QR. Si la cámara no está disponible, usa el código y la clave.</p></div>
        <div class="sa-p2p-pair-grid">
          <div style="text-align:center"><div class="sa-p2p-section-label" style="margin-bottom:7px">QR de vinculación</div>${renderQr(pairUrl)}</div>
          <div class="sa-p2p-code-panel">
            <div><span class="sa-p2p-section-label">Código de 6 dígitos</span><strong class="sa-p2p-pair-code">${esc(descriptor.code.slice(0,3)+' '+descriptor.code.slice(3))}</strong></div>
            <div><span class="sa-p2p-section-label">Clave</span><strong class="sa-p2p-pair-key">${esc(descriptor.key)}</strong></div>
            <p class="sa-p2p-footnote">Expira en 5 minutos. El código por sí solo no autoriza la conexión.</p>
          </div>
        </div>
        <div class="sa-p2p-status" data-pair-status>Esperando a Mini…</div>
      </div>`);
    body().querySelector('[data-back]').addEventListener('click', renderHome);
    const signaling = new window.SaMiniP2P.SignalingClient({ room: descriptor.room, peerId: self.deviceId, proof: descriptor.proof, expiresAt: descriptor.expiresAt });
    activeSession = await window.SaMiniP2P.createRtcSession({
      signaling,
      initiator: true,
      onState: (status, error) => { const box = body()?.querySelector('[data-pair-status]'); if (box && error) box.textContent = 'Error: ' + error.message; },
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
  box.innerHTML = `<div class="sa-p2p-confirm"><strong>${esc(remote.displayName)}</strong><span>quiere vincularse. Confirma que ambos dispositivos muestran:</span><strong class="sa-p2p-sas">${esc(sas)}</strong><div class="sa-p2p-actions">${button('Rechazar', 'data-reject', 'secondary')}${button('Confirmar vínculo', 'data-accept', 'primary', 'link')}</div></div>`;
  box.querySelector('[data-accept]').addEventListener('click', async () => { box.textContent='Esperando confirmación de Mini…'; await accept(); });
  box.querySelector('[data-reject]').addEventListener('click', reject);
}

async function renderPairLinked(peer, channel) {
  activePeer = peer;
  let projectState;
  try { projectState = await getProjectSetupState(); }
  catch (error) { projectState = { ready: false, error }; }
  const linkedHeader = `<div class="sa-p2p-result-title"><span class="sa-p2p-result-icon">${p2pIcon('link', 18)}</span><div><h3>Mini vinculado</h3><p><strong>${esc(peerName(peer))}</strong> quedó reconocido por este SA.</p></div></div>`;
  if (!projectState.ready) {
    setBodyHtml(`<div class="sa-p2p-step">${linkedHeader}<div class="sa-p2p-status is-warning">El vínculo está listo. Para enviar empleados, configura primero el proyecto oficial.</div><div class="sa-p2p-actions">${button('Configurar proyecto','data-configure-project','primary','project')}${button('Terminar','data-done','secondary')}</div></div>`);
    body().querySelector('[data-configure-project]').addEventListener('click', () => window.openProjectSetupModal?.());
    body().querySelector('[data-done]').addEventListener('click', renderHome);
    return;
  }
  setBodyHtml(`<div class="sa-p2p-step">${linkedHeader}<div class="sa-p2p-status">Proyecto: <strong>${esc(projectState.activeProject?.name || projectState.activeProjectId)}</strong></div><label class="sa-p2p-checkbox"><input type="checkbox" data-salary> <span>Incluir sueldo en este roster</span></label><div class="sa-p2p-actions">${button('Enviar roster ahora','data-send-now','primary','send')}${button('Terminar','data-done','secondary')}</div><div class="sa-p2p-status" data-send-status hidden></div></div>`);
  body().querySelector('[data-send-now]').addEventListener('click', () => { const status=body().querySelector('[data-send-status]'); if(status) status.hidden=false; sendRosterOnChannel(channel, peer, body().querySelector('[data-salary]').checked); });
  body().querySelector('[data-done]').addEventListener('click', renderHome);
}

function renderPairError(error) {
  const message = error?.message || String(error || 'Error P2P');
  const box = body()?.querySelector('[data-pair-status]');
  if (box) { box.classList.add('is-error'); box.innerHTML = `<strong>No se pudo completar.</strong><br>${esc(message)}`; }
  else notify(message, 'error');
}

async function connectTrustedAndSend(peerId) {
  cleanupSession();
  try {
    const projectState = await getProjectSetupState();
    if (!projectState.ready) { notify('Configura un proyecto activo antes de enviar el roster.', 'warning'); await window.openProjectSetupModal?.(); return; }
    const identityStore = store();
    const self = await identityStore.getSelf();
    const peer = await identityStore.getPeer(peerId);
    if (!peer || peer.peerApp !== 'mini') throw new Error('Mini vinculado no encontrado.');
    activePeer = peer;
    setBodyHtml(`<div class="sa-p2p-step">${backButton()}<div><h3>Enviar roster a ${esc(peerName(peer))}</h3><p>Proyecto: <strong>${esc(projectState.activeProject?.name || projectState.activeProjectId)}</strong>. En Mini abre Transferencias → Personal / Roster → Esperar roster.</p></div><label class="sa-p2p-checkbox"><input type="checkbox" data-salary> <span>Incluir sueldo en esta transferencia</span></label><div class="sa-p2p-status" data-connect-status>Buscando el Mini vinculado…</div></div>`);
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
            if (box) box.innerHTML = `<div class="sa-p2p-auth-ready"><span>${p2pIcon('link',16)} ${esc(peerName(peer))} autenticado.</span>${button('Enviar roster','data-trusted-send','primary','send')}</div>`;
            box?.querySelector('[data-trusted-send]')?.addEventListener('click', () => sendRosterOnChannel(channel, peer, body().querySelector('[data-salary]').checked));
          },
          onError: error => { const box=body()?.querySelector('[data-connect-status]'); if(box) box.textContent='Autenticación falló: '+error.message; }
        });
      }
    });
  } catch (error) { notify(error.message || error,'error'); renderHome(); }
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
    if (status) { status.classList.add('is-success'); status.innerHTML = `<strong>${p2pIcon('link', 15)} Roster recibido y validado por ${esc(peerName(peer))}</strong><br><span>Mini todavía debe revisarlo y confirmar la importación.</span>`; }
    notify('Roster enviado y validado por Mini', 'success');
  } catch (error) {
    if (status) { status.classList.add('is-error'); status.innerHTML = `<strong>Error:</strong> ${esc(error.message || error)}`; }
  }
}

export async function openP2PRosterTransfer() {
  try {
    window.closeExportMenu?.();
    await renderHome();
  } catch (error) { notify(error.message || error,'error'); }
}

export function registerP2PRosterGlobals() {
  window.openP2PRosterTransfer = openP2PRosterTransfer;
  window.closeP2PRosterTransfer = closeP2PRosterTransfer;
  if (!projectSetupListenerAttached) {
    window.addEventListener('projects:setup-changed', () => {
      if (modal()) renderHome().catch(error => notify(error.message || error, 'error'));
    });
    projectSetupListenerAttached = true;
  }
}
