import { state } from '../../core/AppState.js';
import { eventBus } from '../../core/Events.js';
import { getEntityScope } from '../projects/ProjectContext.js';
import { p2pPeerAliasStore } from './P2PPeerAliasStore.js';
import { p2pActivityStore, P2P_ACTIVITY_KINDS, P2P_ACTIVITY_STATUSES, P2P_ACTIVITY_MAX_RECENT, getActivityKindLabel, getActivityStatusLabel } from './P2PActivityStore.js';
import { P2P_SUCCESS_EVENTS, signalP2PSuccess } from './P2PSuccessFeedback.js';
import { getP2PPresenceManager, sortPeersByPresenceAndActivity } from './P2PPresenceManager.js';
import {
  buildSaMiniRosterPayload,
  resolveSaMiniRosterScope,
  selectSaMiniRosterEmployees
} from '../export/SaMiniRosterExport.js';
import { p2pBackupBridge } from './P2PBackupBridge.js';

const MINI_PAIR_BASE_URL = 'https://miniasist.erlin.do/';
const MODAL_ID = 'sa-p2p-roster-modal';
const store = () => window.SaMiniP2P.makeIdentityStore('sa', 'SA - Oficina');
const aliasStore = p2pPeerAliasStore;
let activeSession = null;
let activeChannel = null;
let activePeer = null;
let projectSetupListenerAttached = false;
let headerIndicatorListenerAttached = false;
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

export function formatActivityDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date.toLocaleString('es-DO') : 'Sin registro';
}

function makeActivityId(prefix) {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  } catch (_) {}
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function safeRecordActivity(entry) {
  try { const result = p2pActivityStore.recordActivity(entry); scheduleSaP2PHeaderRefresh(); return result; }
  catch (_) { return null; }
}

function safeUpdateActivity(id, patch) {
  try { const result = p2pActivityStore.updateActivity(id, patch); scheduleSaP2PHeaderRefresh(); return result; }
  catch (_) { return null; }
}

export function getRecentP2PActivity(limit = P2P_ACTIVITY_MAX_RECENT) {
  try { return p2pActivityStore.listRecent({ limit }); }
  catch (_) { return []; }
}

export function getPendingP2PActivityCount() {
  try { return p2pActivityStore.getPendingCount(); }
  catch (_) { return 0; }
}

export async function getPendingP2PReviewCount(peerId = null) {
  let count = 0;
  try {
    const provider = window.getSaP2PPendingReviewCount;
    if (typeof provider === 'function') {
      const value = await provider(peerId);
      count = Number.isSafeInteger(value) && value > 0 ? value : 0;
    }
  } catch (_) {
    count = 0;
  }
  const stagedBackupsCount = p2pBackupBridge?.getStagedCount ? p2pBackupBridge.getStagedCount() : 0;
  return count + stagedBackupsCount;
}

export async function getActionablePendingReviewCountsByPeer() {
  const counts = new Map();
  try {
    const provider = window.getSaP2PActionablePendingReviewGroups;
    if (typeof provider === 'function') {
      const groups = await provider();
      if (Array.isArray(groups)) {
        for (const g of groups) {
          const pId = g?.deviceId || g?.current?.metadata?.sourcePeerId;
          if (pId) counts.set(String(pId), (counts.get(String(pId)) || 0) + 1);
        }
      }
    }
  } catch (_) {}
  return counts;
}

function saP2PHeaderIndicatorEl() {
  try { return document.getElementById('header-p2p-indicator'); }
  catch (_) { return null; }
}

function isSaP2PChannelLive() {
  try {
    if (!activeChannel || activeChannel.readyState !== 'open') return false;
    return window.SaMiniP2P?.isChannelAuthenticated?.(activeChannel) === true;
  } catch (_) { return false; }
}

export async function refreshSaP2PHeaderIndicator() {
  const button = saP2PHeaderIndicatorEl();
  if (!button) return 'missing';
  let peers = [];
  try { peers = (await store().listPeers()).filter(peer => peer?.peerApp === 'mini'); }
  catch (_) { peers = []; }

  const presenceMgr = typeof window !== 'undefined' ? (window.p2pPresenceManager || getP2PPresenceManager()) : getP2PPresenceManager();
  const onlinePeers = presenceMgr ? presenceMgr.getOnlinePeers(peers) : [];
  const onlineCount = onlinePeers.length;
  const isTransferring = (presenceMgr && typeof presenceMgr.isAnyTransferring === 'function') ? presenceMgr.isAnyTransferring() : false;

  let stateName = 'unlinked';
  if (peers.length > 0) {
    if (isTransferring) {
      stateName = 'transferring';
    } else if (onlineCount > 0 || isSaP2PChannelLive()) {
      stateName = 'connected';
    } else {
      stateName = 'disconnected';
    }
  }

  const pending = await getPendingP2PReviewCount();

  button.setAttribute('data-p2p-state', stateName);

  // Red badge: actionable pending review count > 0 ONLY (never combine with green)
  const redBadge = button.querySelector?.('[data-p2p-header-badge]');
  if (redBadge) {
    if (pending > 0) {
      redBadge.hidden = false;
      redBadge.textContent = pending > 99 ? '99+' : String(pending);
      redBadge.setAttribute('aria-label', `${pending} revisiones pendientes`);
    } else {
      redBadge.hidden = true;
      redBadge.textContent = '';
    }
  }

  // Green badge: online peer count ONLY when onlineCount > 1
  const greenBadge = button.querySelector?.('[data-p2p-online-badge]');
  if (greenBadge) {
    if (onlineCount > 1) {
      greenBadge.hidden = false;
      greenBadge.textContent = onlineCount > 99 ? '99+' : String(onlineCount);
      greenBadge.setAttribute('aria-label', `${onlineCount} dispositivos conectados`);
    } else {
      greenBadge.hidden = true;
      greenBadge.textContent = '';
    }
  }

  let stateLabel = 'no vinculado';
  if (stateName === 'transferring') {
    stateLabel = 'transfiriendo';
  } else if (stateName === 'connected') {
    stateLabel = onlineCount > 1 ? `${onlineCount} dispositivos conectados` : 'conectado';
  } else if (stateName === 'disconnected') {
    stateLabel = 'vinculado, sin conexión activa';
  }

  const pendingLabel = pending > 0 ? `. ${pending} pendiente${pending === 1 ? '' : 's'}` : '';
  button.setAttribute('aria-label', `Mini ${stateLabel}${pendingLabel}. Abrir Transferencias`);
  button.setAttribute('title', `Mini ${stateLabel}${pendingLabel}`);
  return stateName;
}

function scheduleSaP2PHeaderRefresh() {
  try { Promise.resolve().then(() => refreshSaP2PHeaderIndicator()).catch(() => {}); }
  catch (_) {}
}

export function buildPendingBadgeMarkup(pendingCount) {
  const count = Number(pendingCount);
  const safe = Number.isSafeInteger(count) && count > 0 ? count : 0;
  if (safe === 0) return '<span class="sa-p2p-badge" data-p2p-pending-badge hidden aria-hidden="true"></span>';
  const label = `${safe} pendiente${safe === 1 ? '' : 's'}`;
  return `<span class="sa-p2p-badge" data-p2p-pending-badge aria-label="${safe} pendientes">${safe}</span><span class="sa-p2p-visually-hidden">${esc(label)}</span>`;
}

function activityStatusClass(status) {
  if (status === P2P_ACTIVITY_STATUSES.SUCCESS) return 'is-success';
  if (status === P2P_ACTIVITY_STATUSES.PARTIAL) return 'is-warning';
  if (status === P2P_ACTIVITY_STATUSES.ERROR) return 'is-error';
  return 'is-pending';
}

export function buildActivityListMarkup(entries = []) {
  const list = Array.isArray(entries) ? entries.slice(0, P2P_ACTIVITY_MAX_RECENT) : [];
  if (!list.length) return '<div class="sa-p2p-empty" data-p2p-activity-empty>Sin actividad reciente.</div>';
  return list.map(entry => {
    const kindLabel = getActivityKindLabel(entry.kind);
    const statusLabel = getActivityStatusLabel(entry.status);
    const peerLabel = String(entry.peerName || 'Mini');
    const projectLabel = String(entry.projectName || '').trim();
    const summary = String(entry.summary || '').trim();
    const when = formatActivityDate(entry.updatedAt || entry.createdAt);
    const projectLine = projectLabel ? ` · ${esc(projectLabel)}` : '';
    const summaryLine = summary ? ` · ${esc(summary)}` : '';
    const hasAudit = Boolean(String(entry.peerId || '').trim() || String(entry.saProjectId || '').trim() || String(entry.id || '').trim());
    const detailsButton = hasAudit ? `<button type="button" class="sa-p2p-activity-details" data-p2p-activity-details="${esc(entry.id)}" aria-haspopup="dialog" aria-label="Detalles de actividad">Detalles</button>` : '';
    const auditPopup = hasAudit ? `<div class="sa-p2p-activity-popup" data-p2p-activity-popup="${esc(entry.id)}" role="dialog" aria-label="Detalles de actividad" hidden><div>ID: ${esc(entry.id)}</div>${entry.peerId ? `<div>Mini ID: ${esc(entry.peerId)}</div>` : ''}${entry.saProjectId ? `<div>Proyecto ID: ${esc(entry.saProjectId)}</div>` : ''}<button type="button" data-p2p-activity-close>Cerrar</button></div>` : '';
    return `<div class="sa-p2p-activity-row" data-p2p-activity-row="${esc(entry.id)}"><div class="sa-p2p-activity-copy"><strong>${esc(kindLabel)} · ${esc(peerLabel)}${projectLine}</strong><div class="sa-p2p-activity-meta">${esc(when)}${summaryLine}</div></div><span class="sa-p2p-activity-status ${activityStatusClass(entry.status)}">${esc(statusLabel)}</span>${detailsButton}${auditPopup}</div>`;
  }).join('');
}

export function buildActivitySectionMarkup(entries = [], pendingCount = 0) {
  const badge = buildPendingBadgeMarkup(pendingCount);
  return `<section class="sa-p2p-activity" aria-labelledby="sa-p2p-activity-title"><div class="sa-p2p-activity-head"><h3 id="sa-p2p-activity-title">Actividad P2P</h3>${badge}</div><div class="sa-p2p-activity-list" data-p2p-activity-list>${buildActivityListMarkup(entries)}</div><p class="sa-p2p-footnote">Historial local de este SA. No cambia datos ni importa asistencia automáticamente.</p></section>`;
}

function wireActivityDetails(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('[data-p2p-activity-details]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-p2p-activity-details');
      const safeId = (globalThis.CSS && typeof globalThis.CSS.escape === 'function') ? globalThis.CSS.escape(id) : id.replace(/[\"\\]/g, '\\$&');
      const popup = root.querySelector(`[data-p2p-activity-popup="${safeId}"]`);
      if (popup) popup.hidden = !popup.hidden;
    });
  });
  root.querySelectorAll('[data-p2p-activity-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const popup = btn.closest('[data-p2p-activity-popup]');
      if (popup) popup.hidden = true;
    });
  });
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

export const SA_SELF_NAME_MAX_LENGTH = 80;

export function normalizeProjectPresentationName(value) {
  const clean = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, SA_SELF_NAME_MAX_LENGTH).join('');
}

export function resolveSaSelfPresentationName(projectState, self) {
  const projectName = normalizeProjectPresentationName(projectState?.activeProject?.name);
  if (projectState?.ready === true && projectName) return projectName;
  const fallback = String(self?.displayName || '').trim().slice(0, SA_SELF_NAME_MAX_LENGTH);
  return fallback || 'SA';
}

export function getNewPairingProjectGate(projectState) {
  if (projectState?.ready !== true || !normalizeProjectPresentationName(projectState?.activeProject?.name)) {
    return {
      code: 'project-not-ready',
      title: 'Configura un proyecto para vincular',
      message: 'SA se presenta con el nombre del proyecto activo. Configura el proyecto para continuar.'
    };
  }
  return null;
}

export async function ensureSaSelfMatchesProject(identityStore, projectState) {
  const gate = getNewPairingProjectGate(projectState);
  if (gate) throw new Error(gate.message);
  const projectName = normalizeProjectPresentationName(projectState.activeProject.name);
  const self = await identityStore.getSelf();
  if (self.displayName !== projectName) {
    await identityStore.renameSelf(projectName);
    return identityStore.getSelf();
  }
  return self;
}

function renderPairingBlockedByProject() {
  setBodyHtml(`<div class="sa-p2p-step">${backButton()}<div><h3>Configura un proyecto para vincular</h3><p>SA se presenta con el nombre del proyecto activo. Configura el proyecto para continuar.</p></div><div class="sa-p2p-actions">${button('Configurar proyecto', 'data-configure-project', 'primary', 'project')}</div></div>`);
  body().querySelector('[data-back]').addEventListener('click', renderHome);
  body().querySelector('[data-configure-project]').addEventListener('click', () => window.openProjectSetupModal?.());
}

function cleanupSession() {
  if (activeMorphCleanup) activeMorphCleanup();
  if (activePeer?.peerId) {
    const presenceMgr = typeof window !== 'undefined' ? (window.p2pPresenceManager || getP2PPresenceManager()) : getP2PPresenceManager();
    presenceMgr?.setPeerTransferring?.(activePeer.peerId, false);
  }
  try { activeSession?.close?.(); } catch (_) {}
  activeSession = null;
  activeChannel = null;
  activePeer = null;
  scheduleSaP2PHeaderRefresh();
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
  backup: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
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

function askUnlinkBackupConfirmation(name) {
  return new Promise(resolve => {
    if (typeof window.showConfirm !== 'function') {
      notify('No se pudo abrir la confirmación para desvincular.', 'error');
      resolve(false);
      return;
    }
    window.showConfirm({
      title: 'Desvincular SA de respaldo',
      message: `${name} tendrá que volver a vincularse para transferir respaldos.`,
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

  const presenceMgr = typeof window !== 'undefined' ? (window.p2pPresenceManager || getP2PPresenceManager()) : getP2PPresenceManager();
  presenceMgr?.sweepStalePeers?.();

  const rawPeers = (await store().listPeers()).filter(p => p.peerApp === 'mini');
  const backupPeers = (await store().listPeers()).filter(p => p.peerApp === 'sa');
  const pendingCounts = await getActionablePendingReviewCountsByPeer();

  const presenceMap = new Map();
  for (const p of rawPeers) {
    const isOnline = presenceMgr ? presenceMgr.isPeerOnline(p.peerId) : false;
    const state = presenceMgr ? presenceMgr.getPeerState(p.peerId) : 'linked-offline';
    presenceMap.set(p.peerId, { isOnline, state });
  }

  const peers = sortPeersByPresenceAndActivity(rawPeers, presenceMap, pendingCounts);

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

  const stagedBackups = p2pBackupBridge.listStaged();
  const stagedBackupsSection = stagedBackups.length ? `
    <section class="sa-p2p-staged-backups" aria-labelledby="sa-p2p-staged-title">
      <div class="sa-p2p-devices-head">
        <div>
          <h3 id="sa-p2p-staged-title">Respaldos recibidos (pendientes de revisión)</h3>
          <div class="sa-p2p-subtitle">${stagedBackups.length} respaldo${stagedBackups.length === 1 ? '' : 's'} pendiente${stagedBackups.length === 1 ? '' : 's'} de revisión</div>
        </div>
      </div>
      <div class="sa-p2p-peer-list">
        ${stagedBackups.map(b => {
          const isSa = b.sourceApp === 'sa';
          const badge = isSa
            ? '<span class="sa-p2p-badge-solid is-accent">SA ↔ SA</span>'
            : '<span class="sa-p2p-badge-solid is-neutral">Mini → SA</span>';
          const sizeKb = (b.size / 1024).toFixed(1);
          const sizeMb = (b.size / (1024 * 1024)).toFixed(2);
          const sizeLabel = b.size >= 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;
          const shaShort = b.sha256 ? b.sha256.slice(0, 8) : '';
          const actionBtn = isSa
            ? button('Revisar y restaurar', `data-review-backup="${esc(b.transferId)}"`, 'primary', 'backup')
            : button('Descargar archivo', `data-download-backup="${esc(b.transferId)}"`, 'primary', 'download');

          return `
            <div class="sa-p2p-peer-row sa-p2p-staged-row" data-transfer-id="${esc(b.transferId)}">
              <div class="sa-p2p-peer-avatar">
                ${p2pIcon('backup', 17)}
              </div>
              <div class="sa-p2p-peer-copy">
                <div class="sa-p2p-peer-header-line">
                  <strong class="sa-p2p-peer-name">${esc(b.peerName || (isSa ? 'SA' : 'Mini'))}</strong>
                  ${badge}
                </div>
                <div class="sa-p2p-peer-meta">Tamaño: ${sizeLabel} · SHA: ${shaShort}… · Recibido: ${esc(formatPeerDate(b.receivedAt))}</div>
              </div>
              <div class="sa-p2p-device-actions">
                ${actionBtn}
                <button type="button" class="sa-p2p-icon-btn" data-discard-backup="${esc(b.transferId)}" aria-label="Descartar respaldo" title="Descartar">${p2pIcon('close', 16)}</button>
              </div>
            </div>`;
        }).join('')}
      </div>
    </section>` : '';

  const backupPeersSection = `
    <section class="sa-p2p-backup-devices" aria-labelledby="sa-p2p-backup-devices-title">
      <div class="sa-p2p-devices-head">
        <div>
          <h3 id="sa-p2p-backup-devices-title">Respaldos entre SA (SA ↔ SA)</h3>
          <div class="sa-p2p-subtitle">${backupPeers.length} SA${backupPeers.length === 1 ? '' : 's'} vinculado${backupPeers.length === 1 ? '' : 's'} para transferir respaldos</div>
        </div>
      </div>
      <div class="sa-p2p-peer-list">
        ${backupPeers.length ? backupPeers.map(peer => {
          const original = peerOriginalName(peer);
          const alias = aliasStore.getAlias(peer.peerId);
          const originalLine = alias ? ` · Original: ${esc(original)}` : '';
          return `
            <div class="sa-p2p-peer-row sa-p2p-backup-peer-card" data-backup-peer-id="${esc(peer.peerId)}">
              <div class="sa-p2p-peer-avatar">
                ${p2pIcon('backup', 17)}
              </div>
              <div class="sa-p2p-peer-copy">
                <div class="sa-p2p-peer-header-line">
                  <strong class="sa-p2p-peer-name">${esc(peerName(peer))}</strong>
                  <span class="sa-p2p-badge-solid is-accent">SA ↔ SA</span>
                </div>
                <div class="sa-p2p-peer-meta">Vinculado para respaldo${originalLine}</div>
              </div>
              <div class="sa-p2p-device-actions">
                ${button('Enviar respaldo', `data-send-backup-peer="${esc(peer.peerId)}"`, 'primary', 'backup')}
                ${button('Esperar respaldo', `data-wait-backup-peer="${esc(peer.peerId)}"`, 'secondary', 'download')}
                <button type="button" class="sa-p2p-icon-btn" data-unlink-backup-peer="${esc(peer.peerId)}" aria-label="Desvincular ${esc(peerName(peer))}" title="Desvincular">${p2pIcon('unlink', 16)}</button>
              </div>
            </div>`;
        }).join('') : '<div class="sa-p2p-empty">No hay otros SA vinculados para respaldo. Usa el botón a continuación para vincular uno.</div>'}
      </div>
      <div>
        ${button('Vincular SA para respaldo', 'data-new-backup-pair aria-label="Vincular otro SA para transferir respaldos"', 'secondary', 'link')}
      </div>
    </section>`;

  const peerRows = peers.length ? peers.map(peer => {
    const alias = aliasStore.getAlias(peer.peerId);
    const original = peerOriginalName(peer);
    const pres = presenceMap.get(peer.peerId) || { isOnline: false, state: 'linked-offline' };
    const isOnline = pres.isOnline;
    const peerState = pres.state;
    const pendingCount = pendingCounts.get(peer.peerId) || 0;
    const lastSeen = formatPeerDate(peer.lastSeenAt || peer.linkedAt);
    const originalLine = alias ? ` · Original: ${esc(original)}` : '';

    const typeLabel = peer.peerApp === 'mini' ? 'Mini' : (peer.peerApp ? esc(peer.peerApp) : '');
    const typeBadge = typeLabel ? `<span class="sa-p2p-peer-type">${typeLabel}</span>` : '';

    let stateLabel = 'Sin conexión';
    let stateClass = 'is-offline';
    if (peerState === 'transferring') {
      stateLabel = 'Transfiriendo';
      stateClass = 'is-transferring';
    } else if (isOnline) {
      stateLabel = 'Conectado';
      stateClass = 'is-online';
    } else if (peerState === 'connecting') {
      stateLabel = 'Conectando';
      stateClass = 'is-connecting';
    }
    const stateBadge = `<span class="sa-p2p-peer-status ${stateClass}">${stateLabel}</span>`;

    const pendingBadge = pendingCount > 0
      ? `<span class="sa-p2p-peer-pending-badge" aria-label="${pendingCount} revisiones pendientes">${pendingCount} pendiente${pendingCount === 1 ? '' : 's'}</span>`
      : '';

    const metaLine = isOnline
      ? `${originalLine ? originalLine.replace(/^ · /, '') : 'Disponible para transferencias'}`
      : `Última conexión: ${esc(lastSeen)}${originalLine}`;

    return `
      <div class="sa-p2p-peer-row sa-p2p-peer-card ${isOnline ? 'is-online' : ''}" data-peer-id="${esc(peer.peerId)}" data-peer-state="${esc(peerState)}">
        <div class="sa-p2p-peer-avatar ${isOnline ? 'is-online' : ''}">
          ${p2pIcon('mini', 17)}
          <span class="sa-p2p-peer-dot ${isOnline ? 'is-online' : ''}" aria-hidden="true"></span>
        </div>
        <div class="sa-p2p-peer-copy" data-select-peer="${esc(peer.peerId)}" role="button" tabindex="0" aria-label="Seleccionar ${esc(peerName(peer))}">
          <div class="sa-p2p-peer-header-line">
            <strong class="sa-p2p-peer-name">${esc(peerName(peer))}</strong>
            ${typeBadge}
            ${stateBadge}
            ${pendingBadge}
          </div>
          <div class="sa-p2p-peer-meta">${metaLine}</div>
        </div>
        <div class="sa-p2p-device-actions">
          <button type="button" class="sa-p2p-icon-btn" data-rename-peer="${esc(peer.peerId)}" aria-label="Cambiar nombre de ${esc(peerName(peer))}" title="Cambiar nombre">${p2pIcon('edit', 16)}</button>
          ${button('Enviar roster', `data-send-peer="${esc(peer.peerId)}" ${projectState.ready ? '' : 'disabled aria-disabled="true" title="Configura un proyecto antes de enviar"'}`, 'primary', 'send')}
          <button type="button" class="sa-p2p-icon-btn" data-backup-peer="${esc(peer.peerId)}" aria-label="Respaldos con ${esc(peerName(peer))}" title="Respaldos">${p2pIcon('backup', 16)}</button>
          <button type="button" class="sa-p2p-icon-btn" data-unlink-peer="${esc(peer.peerId)}" aria-label="Desvincular ${esc(peerName(peer))}" title="Desvincular">${p2pIcon('unlink', 16)}</button>
        </div>
      </div>`;
  }).join('') : '<div class="sa-p2p-empty">Aún no hay Minis vinculados. Usa el botón Vincular Mini para agregar el primero.</div>';

  const selfPresentation = resolveSaSelfPresentationName(projectState, self);
  const pairingGate = getNewPairingProjectGate(projectState);
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
    ${stagedBackupsSection}
    <section class="sa-p2p-devices" aria-labelledby="sa-p2p-devices-title">
      <div class="sa-p2p-devices-head">
        <div><h3 id="sa-p2p-devices-title">Minis vinculados</h3><div class="sa-p2p-subtitle">${peers.length} dispositivo${peers.length === 1 ? '' : 's'} guardado${peers.length === 1 ? '' : 's'} en este SA</div></div>
        <div class="sa-p2p-self">Este SA: <strong>${esc(selfPresentation)}</strong><small>Nombre del proyecto</small></div>
      </div>
      <div class="sa-p2p-peer-list">${peerRows}</div>
    </section>
    ${pairingGate ? '<div class="sa-p2p-status is-warning">SA se presenta con el nombre del proyecto activo. Configura el proyecto para vincular un Mini.</div>' : ''}
    <div>${button('Vincular Mini', 'data-new-pair aria-label="Vincular un nuevo Mini por QR o código"', 'primary', 'link')}</div>
    ${backupPeersSection}
    <p class="sa-p2p-footnote">Vincular sólo crea una relación segura entre dispositivos. Ningún dato se importa o modifica automáticamente.</p>`);
  body().querySelector('[data-new-pair]').classList.add('sa-p2p-link-cta');
  body().querySelector('[data-configure-project]')?.addEventListener('click', () => window.openProjectSetupModal?.());
  body().querySelector('[data-new-pair]').addEventListener('click', startNewPairing);
  body().querySelector('[data-new-backup-pair]')?.addEventListener('click', startBackupPairing);

  body().querySelectorAll('[data-review-backup]').forEach(btn => btn.addEventListener('click', async () => {
    const transferId = btn.dataset.reviewBackup;
    try {
      await p2pBackupBridge.reviewAndRestoreSaBackup(transferId, {
        onSuccess: () => {
          notify('Respaldo restaurado con éxito.', 'success');
          scheduleSaP2PHeaderRefresh();
          renderHome();
        },
        onError: err => {
          notify(err.message || err, 'error');
        }
      });
    } catch (err) {
      notify(err.message || err, 'error');
    }
  }));

  body().querySelectorAll('[data-download-backup]').forEach(btn => btn.addEventListener('click', () => {
    const transferId = btn.dataset.downloadBackup;
    try {
      p2pBackupBridge.downloadCrossAppBackup(transferId);
      notify('Archivo de respaldo descargado correctamente.', 'info');
      renderHome();
    } catch (err) {
      notify(err.message || err, 'error');
    }
  }));

  body().querySelectorAll('[data-discard-backup]').forEach(btn => btn.addEventListener('click', () => {
    const transferId = btn.dataset.discardBackup;
    p2pBackupBridge.removeStaged(transferId);
    scheduleSaP2PHeaderRefresh();
    renderHome();
  }));

  body().querySelectorAll('[data-send-backup-peer]').forEach(btn => btn.addEventListener('click', () => {
    connectTrustedAndSendBackup(btn.dataset.sendBackupPeer);
  }));

  body().querySelectorAll('[data-wait-backup-peer]').forEach(btn => btn.addEventListener('click', () => {
    connectTrustedAndReceiveBackup(btn.dataset.waitBackupPeer);
  }));

  body().querySelectorAll('[data-backup-peer]').forEach(btn => btn.addEventListener('click', () => {
    openPeerBackupSurface(btn.dataset.backupPeer);
  }));

  body().querySelectorAll('[data-unlink-backup-peer]').forEach(btn => btn.addEventListener('click', async () => {
    const peerId = btn.dataset.unlinkBackupPeer;
    const peer = backupPeers.find(item => String(item.peerId) === String(peerId));
    if (!await askUnlinkBackupConfirmation(peerName(peer || { displayName: 'este SA', peerApp: 'sa' }))) return;
    await store().removePeer(peerId);
    aliasStore.removeAlias(peerId);
    renderHome();
  }));

  body().querySelectorAll('[data-select-peer]').forEach(el => {
    el.addEventListener('click', () => {
      const peerId = el.dataset.selectPeer;
      const sendBtn = el.closest('.sa-p2p-peer-row')?.querySelector(`[data-send-peer="${peerId}"]`);
      if (sendBtn && !sendBtn.disabled) {
        connectTrustedAndSend(peerId);
      }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });
  body().querySelectorAll('[data-rename-peer]').forEach(btn => btn.addEventListener('click', () => renderPeerAliasEditor(btn.dataset.renamePeer)));
  body().querySelectorAll('[data-send-peer]').forEach(btn => btn.addEventListener('click', () => connectTrustedAndSend(btn.dataset.sendPeer)));
  body().querySelectorAll('[data-unlink-peer]').forEach(btn => btn.addEventListener('click', async () => {
    const peerId = btn.dataset.unlinkPeer;
    const peer = peers.find(item => String(item.peerId) === String(peerId));
    if (!await askUnlinkConfirmation(peerName(peer || { displayName: 'este Mini', peerApp: 'mini' }))) return;
    await store().removePeer(peerId);
    aliasStore.removeAlias(peerId);
    presenceMgr?.refreshPeers?.();
    renderHome();
  }));
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
    let projectState;
    try { projectState = await getProjectSetupState(); }
    catch (error) { projectState = { enabled: true, ready: false, activeProject: null, error }; }
    if (getNewPairingProjectGate(projectState)) {
      renderPairingBlockedByProject();
      return;
    }
    const identityStore = store();
    const self = await ensureSaSelfMatchesProject(identityStore, projectState);
    const descriptor = await window.SaMiniP2P.makePairDescriptor(self);
    const pairUrl = window.SaMiniP2P.buildPairUrl(descriptor, MINI_PAIR_BASE_URL);
    setBodyHtml(`
      <div class="sa-p2p-step">
        ${backButton()}
        <div><h3>Vincular nuevo Mini</h3><p>En Mini, escanea este QR. Si la cámara no está disponible, usa el código y la clave.</p></div>
        <div class="sa-p2p-pair-grid">
          <div class="sa-p2p-qr-block"><div class="sa-p2p-section-label sa-p2p-qr-label">QR de vinculación</div>${renderQr(pairUrl)}</div>
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

function signalPairLinkedFeedback() {
  try {
    const iconEl = body()?.querySelector('.sa-p2p-result-icon');
    signalP2PSuccess(P2P_SUCCESS_EVENTS.PAIR_LINKED, {
      message: 'Mini vinculado correctamente',
      title: 'Mini vinculado',
      statusEl: iconEl || undefined,
      pulseEl: iconEl || undefined
    });
  } catch (_) {}
}

async function renderPairLinked(peer, channel) {
  activePeer = peer;
  scheduleSaP2PHeaderRefresh();
  let projectState;
  try { projectState = await getProjectSetupState(); }
  catch (error) { projectState = { ready: false, error }; }
  const linkedHeader = `<div class="sa-p2p-result-title"><span class="sa-p2p-result-icon">${p2pIcon('link', 18)}</span><div><h3>Mini vinculado</h3><p><strong>${esc(peerName(peer))}</strong> quedó reconocido por este SA.</p></div></div>`;
  if (!projectState.ready) {
    setBodyHtml(`<div class="sa-p2p-step">${linkedHeader}<div class="sa-p2p-status is-warning">El vínculo está listo. Para enviar empleados, configura primero el proyecto oficial.</div><div class="sa-p2p-actions">${button('Configurar proyecto','data-configure-project','primary','project')}${button('Terminar','data-done','secondary')}</div></div>`);
    body().querySelector('[data-configure-project]').addEventListener('click', () => window.openProjectSetupModal?.());
    body().querySelector('[data-done]').addEventListener('click', renderHome);
    signalPairLinkedFeedback();
    return;
  }
  setBodyHtml(`<div class="sa-p2p-step">${linkedHeader}<div class="sa-p2p-status">Proyecto: <strong>${esc(projectState.activeProject?.name || projectState.activeProjectId)}</strong></div><label class="sa-p2p-checkbox"><input type="checkbox" data-salary> <span>Incluir sueldo en este roster</span></label><div class="sa-p2p-actions">${button('Enviar roster ahora','data-send-now','primary','send')}${button('Terminar','data-done','secondary')}</div><div class="sa-p2p-status" data-send-status hidden></div></div>`);
  body().querySelector('[data-send-now]').addEventListener('click', () => { const status=body().querySelector('[data-send-status]'); if(status) status.hidden=false; const ctx={ projectName: String(projectState.activeProject?.name || '').trim(), saProjectId: String(projectState.activeProjectId || projectState.activeProject?.id || ''), activityId: makeActivityId('roster') }; sendRosterOnChannel(channel, peer, body().querySelector('[data-salary]').checked === true, ctx); });
  body().querySelector('[data-done]').addEventListener('click', renderHome);
  signalPairLinkedFeedback();
}

function renderPairError(error) {
  const message = error?.message || String(error || 'Error P2P');
  const box = body()?.querySelector('[data-pair-status]');
  if (box) { box.classList.add('is-error'); box.innerHTML = `<strong>No se pudo completar.</strong><br>${esc(message)}`; }
  else notify(message, 'error');
}

async function connectTrustedAndSend(peerId) {
  cleanupSession();
  let activityId = null;
  const presenceMgr = typeof window !== 'undefined' ? (window.p2pPresenceManager || getP2PPresenceManager()) : getP2PPresenceManager();
  try {
    const projectState = await getProjectSetupState();
    if (!projectState.ready) { notify('Configura un proyecto activo antes de enviar el roster.', 'warning'); await window.openProjectSetupModal?.(); return; }
    const identityStore = store();
    const self = await identityStore.getSelf();
    const peer = await identityStore.getPeer(peerId);
    if (!peer || peer.peerApp !== 'mini') throw new Error('Mini vinculado no encontrado.');
    activePeer = peer;
    presenceMgr?.setPeerTransferring?.(peerId, true);
    const humanPeer = peerName(peer);
    const humanProject = String(projectState.activeProject?.name || '').trim();
    const auditProjectId = String(projectState.activeProjectId || projectState.activeProject?.id || '');
    activityId = makeActivityId('roster');
    const activityContext = { projectName: humanProject, saProjectId: auditProjectId, activityId };
    safeRecordActivity({ id: activityId, kind: P2P_ACTIVITY_KINDS.ROSTER, status: P2P_ACTIVITY_STATUSES.PENDING, peerName: humanPeer, projectName: humanProject, summary: 'Conectando con Mini…', peerId: String(peer?.peerId || ''), saProjectId: auditProjectId });
    setBodyHtml(`<div class="sa-p2p-step">${backButton()}<div><h3>Enviar roster a ${esc(humanPeer)}</h3><p>Proyecto: <strong>${esc(humanProject || projectState.activeProjectId)}</strong>. Al autenticar, el roster se envía automáticamente una sola vez.</p></div><label class="sa-p2p-checkbox"><input type="checkbox" data-salary> <span>Incluir sueldo en esta transferencia</span></label><div class="sa-p2p-status" data-connect-status>Buscando el Mini vinculado…</div></div>`);
    body().querySelector('[data-back]').addEventListener('click', () => {
      safeUpdateActivity(activityId, { status: P2P_ACTIVITY_STATUSES.ERROR, summary: 'Transferencia cancelada por el usuario.' });
      presenceMgr?.setPeerTransferring?.(peerId, false);
      cleanupSession();
      renderHome();
    });
    const route = await window.SaMiniP2P.deriveTrustedRoute(peer.linkToken);
    const signaling = new window.SaMiniP2P.SignalingClient({ room: route.room, peerId: self.deviceId, proof: route.proof });
    let autoSendStarted = false;
    const triggerAutoSend = (channel) => {
      if (autoSendStarted) return;
      autoSendStarted = true;
      const includeSalaryAtAuth = body()?.querySelector('[data-salary]')?.checked === true;
      const box = body()?.querySelector('[data-connect-status]');
      if (box) box.textContent = `${humanPeer} autenticado. Enviando roster automáticamente…`;
      sendRosterOnChannel(channel, peer, includeSalaryAtAuth, activityContext);
    };
    activeSession = await window.SaMiniP2P.createRtcSession({
      signaling, initiator: true,
      onState: (status, error) => { const box=body()?.querySelector('[data-connect-status]'); if(box && error) box.textContent='Error: '+error.message; },
      onChannel: channel => {
        activeChannel = channel;
        presenceMgr?.registerChannel?.(peer.peerId, channel, activeSession);
        window.SaMiniP2PPairing.attachTrusted(channel, {
          self, peer, store: identityStore,
          onAuthenticated: () => { scheduleSaP2PHeaderRefresh(); triggerAutoSend(channel); },
          onError: error => {
            presenceMgr?.setPeerTransferring?.(peer.peerId, false);
            const box=body()?.querySelector('[data-connect-status]');
            if (box) box.textContent='Autenticación falló: '+error.message;
            safeUpdateActivity(activityId, { status: P2P_ACTIVITY_STATUSES.ERROR, summary: String(error?.message || 'Autenticación falló').slice(0, 280) });
          }
        });
      }
    });
  } catch (error) {
    presenceMgr?.setPeerTransferring?.(peerId, false);
    try {
      if (activityId) safeUpdateActivity(activityId, { status: P2P_ACTIVITY_STATUSES.ERROR, summary: String(error?.message || error || 'Error de conexión').slice(0, 280) });
    } catch (_) {}
    notify(error.message || error,'error');
    renderHome();
  }
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

async function sendRosterOnChannel(channel, peer, includeSalary, activityContext = {}) {
  const status = body()?.querySelector('[data-send-status]') || body()?.querySelector('[data-connect-status]');
  const humanPeer = peerName(peer);
  const humanProject = String(activityContext.projectName || '').trim();
  const auditProjectId = String(activityContext.saProjectId || '');
  const activityId = String(activityContext.activityId || makeActivityId('roster'));
  const presenceMgr = typeof window !== 'undefined' ? (window.p2pPresenceManager || getP2PPresenceManager()) : getP2PPresenceManager();
  safeRecordActivity({ id: activityId, kind: P2P_ACTIVITY_KINDS.ROSTER, status: P2P_ACTIVITY_STATUSES.PENDING, peerName: humanPeer, projectName: humanProject, summary: 'Enviando roster…', peerId: String(peer?.peerId || ''), saProjectId: auditProjectId });
  try {
    const { payload, text } = await buildRosterText(includeSalary);
    if (status) status.textContent = `Preparando ${payload.employees.length} empleados…`;
    const transfer = await window.SaMiniP2P.sendPayload(channel, {
      kind: 'roster', schema: 'sa-roster/v1', text,
      onProgress: progress => { if (status) status.textContent = `Enviando… ${Math.round(progress*100)}%`; }
    });
    if (status) status.textContent = 'Bytes enviados. Esperando validación de Mini…';
    await waitForRosterStageAck(channel, transfer);
    safeUpdateActivity(activityId, { status: P2P_ACTIVITY_STATUSES.SUCCESS, summary: `${payload.employees.length} empleados validados` });
    if (status) { status.classList.add('is-success'); status.innerHTML = `<strong>${p2pIcon('link', 15)} Roster recibido y validado por ${esc(humanPeer)}</strong><br><span>Mini todavía debe revisarlo y confirmar la importación.</span>`; }
    try {
      signalP2PSuccess(P2P_SUCCESS_EVENTS.ROSTER_VALIDATED, {
        message: 'Roster enviado y validado por Mini',
        title: 'Roster validado',
        statusEl: status || undefined,
        pulseEl: status || undefined
      });
    } catch (_) {
      notify('Roster enviado y validado por Mini', 'success');
    }
  } catch (error) {
    safeUpdateActivity(activityId, { status: P2P_ACTIVITY_STATUSES.ERROR, summary: String(error?.message || error || 'Error').slice(0, 280) });
    if (status) { status.classList.add('is-error'); status.innerHTML = `<strong>Error:</strong> ${esc(error.message || error)}`; }
  } finally {
    presenceMgr?.setPeerTransferring?.(peer.peerId, false);
  }
}

async function startBackupPairing() {
  cleanupSession();
  try {
    const identityStore = store();
    const self = await identityStore.getSelf();
    const descriptor = await window.SaMiniP2P.makePairDescriptor(self);

    setBodyHtml(`
      <div class="sa-p2p-step">
        ${backButton()}
        <div>
          <h3>Vincular otro SA para respaldo</h3>
          <p>Para conectar dos instancias de SA entre sí, un SA comparte este código y el otro lo ingresa.</p>
        </div>
        <div class="sa-p2p-pair-grid">
          <div class="sa-p2p-code-panel">
            <span class="sa-p2p-section-label">Opción 1 · Código generado por este SA</span>
            <div><span class="sa-p2p-section-label">Código de 6 dígitos</span><strong class="sa-p2p-pair-code">${esc(descriptor.code.slice(0,3)+' '+descriptor.code.slice(3))}</strong></div>
            <div><span class="sa-p2p-section-label">Clave</span><strong class="sa-p2p-pair-key">${esc(descriptor.key)}</strong></div>
            <p class="sa-p2p-footnote">Expira en 5 minutos. El otro SA debe ingresar este código y clave.</p>
          </div>
          <div class="sa-p2p-code-panel">
            <span class="sa-p2p-section-label">Opción 2 · Ingresar código del otro SA</span>
            <div class="sa-p2p-field">
              <label for="sa-backup-peer-code">Código de 6 dígitos</label>
              <input id="sa-backup-peer-code" data-backup-code placeholder="Ej: 123 456" maxlength="7">
            </div>
            <div class="sa-p2p-field">
              <label for="sa-backup-peer-key">Clave del otro SA</label>
              <input id="sa-backup-peer-key" data-backup-key placeholder="Ej: k-a1b2c3d4" maxlength="32">
            </div>
            <div>
              ${button('Conectar con código del otro SA', 'data-backup-join', 'secondary', 'link')}
            </div>
          </div>
        </div>
        <div class="sa-p2p-status" data-pair-status>Esperando al otro SA…</div>
      </div>`);

    body().querySelector('[data-back]').addEventListener('click', renderHome);

    const signaling = new window.SaMiniP2P.SignalingClient({
      room: descriptor.room,
      peerId: self.deviceId,
      proof: descriptor.proof,
      expiresAt: descriptor.expiresAt
    });

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
          self,
          descriptor,
          initiator: true,
          store: identityStore,
          allowSameApp: true,
          onCandidate: ({ remote, sas, accept, reject }) => renderPairConfirmation(remote, sas, accept, reject),
          onLinked: peer => renderBackupPairLinked(peer, channel),
          onRejected: () => renderPairError('El otro SA rechazó el vínculo.'),
          onError: renderPairError
        });
      }
    });

    body().querySelector('[data-backup-join]')?.addEventListener('click', async () => {
      const codeInput = body().querySelector('[data-backup-code]');
      const keyInput = body().querySelector('[data-backup-key]');
      const rawCode = (codeInput?.value || '').replace(/\s+/g, '');
      const rawKey = (keyInput?.value || '').trim();
      if (!rawCode || rawCode.length !== 6 || !rawKey) {
        notify('Ingresa el código de 6 dígitos y la clave del otro SA.', 'warning');
        return;
      }
      try {
        cleanupSession();
        const box = body()?.querySelector('[data-pair-status]');
        if (box) box.textContent = 'Conectando con el otro SA…';
        const joinDescriptor = await window.SaMiniP2P.pairDescriptorFromManual(rawCode, rawKey);
        const joinSignaling = new window.SaMiniP2P.SignalingClient({
          room: joinDescriptor.room,
          peerId: self.deviceId,
          proof: joinDescriptor.proof,
          expiresAt: joinDescriptor.expiresAt
        });

        activeSession = await window.SaMiniP2P.createRtcSession({
          signaling: joinSignaling,
          initiator: false,
          onState: (status, error) => {
            const b = body()?.querySelector('[data-pair-status]');
            if (b && error) b.textContent = 'Error: ' + error.message;
          },
          onChannel: channel => {
            activeChannel = channel;
            window.SaMiniP2PPairing.attachPairing(channel, {
              self,
              descriptor: joinDescriptor,
              initiator: false,
              store: identityStore,
              allowSameApp: true,
              onCandidate: ({ remote, sas, accept, reject }) => renderPairConfirmation(remote, sas, accept, reject),
              onLinked: peer => renderBackupPairLinked(peer, channel),
              onRejected: () => renderPairError('El otro SA rechazó el vínculo.'),
              onError: renderPairError
            });
          }
        });
      } catch (err) {
        renderPairError(err);
      }
    });
  } catch (error) {
    renderPairError(error);
  }
}

async function renderBackupPairLinked(peer, channel) {
  activePeer = peer;
  scheduleSaP2PHeaderRefresh();
  const linkedHeader = `
    <div class="sa-p2p-result-title">
      <span class="sa-p2p-result-icon">${p2pIcon('link', 18)}</span>
      <div>
        <h3>SA vinculado para respaldo</h3>
        <p><strong>${esc(peerName(peer))}</strong> quedó reconocido para transferir respaldos (SA ↔ SA).</p>
      </div>
    </div>`;

  setBodyHtml(`
    <div class="sa-p2p-step">
      ${linkedHeader}
      <div class="sa-p2p-status">
        Vínculo dedicado para respaldo establecido de forma segura.
      </div>
      <div class="sa-p2p-actions">
        ${button('Enviar respaldo ahora', 'data-send-backup-now', 'primary', 'backup')}
        ${button('Esperar respaldo', 'data-wait-backup-now', 'secondary', 'download')}
        ${button('Terminar', 'data-done', 'secondary')}
      </div>
      <div class="sa-p2p-status" data-send-backup-status hidden></div>
    </div>`);

  let receiverActive = false;
  const startReceiver = () => {
    if (receiverActive) return;
    receiverActive = true;
    const status = body().querySelector('[data-send-backup-status]');
    if (status) {
      status.hidden = false;
      status.classList.remove('is-error', 'is-success');
      status.textContent = `Esperando transferencia de respaldo de ${esc(peerName(peer))}…`;
    }
    p2pBackupBridge.createBackupReceiver({
      channel,
      peer,
      onProgress: pct => {
        const s = body().querySelector('[data-send-backup-status]');
        if (s) {
          s.hidden = false;
          s.textContent = `Recibiendo respaldo… ${Math.round(pct * 100)}%`;
        }
      },
      onStaged: (staged) => {
        scheduleSaP2PHeaderRefresh();
        const s = body().querySelector('[data-send-backup-status]');
        if (s) {
          s.hidden = false;
          s.classList.remove('is-error');
          s.classList.add('is-success');
          const sizeMb = (staged.size / (1024 * 1024)).toFixed(2);
          s.innerHTML = `<strong>${p2pIcon('backup', 15)} Respaldo recibido y verificado</strong><br><span>Tamaño: ${sizeMb} MB · SHA-256 verificado. Quedó guardado en pendientes de revisión.</span>`;
        }
        notify('Respaldo recibido y validado exitosamente.', 'success');
      },
      onRejected: ({ reason }) => {
        const s = body().querySelector('[data-send-backup-status]');
        if (s) {
          s.hidden = false;
          s.classList.add('is-error');
          s.innerHTML = `<strong>Respaldo rechazado:</strong> ${esc(reason)}`;
        }
        notify(`Respaldo rechazado: ${reason}`, 'warning');
      },
      onError: err => {
        const s = body().querySelector('[data-send-backup-status]');
        if (s) {
          s.hidden = false;
          s.classList.add('is-error');
          s.innerHTML = `<strong>Error de recepción:</strong> ${esc(err.message || err)}`;
        }
        notify(err.message || err, 'error');
      }
    });
  };

  body().querySelector('[data-wait-backup-now]')?.addEventListener('click', startReceiver);

  body().querySelector('[data-send-backup-now]').addEventListener('click', async () => {
    const status = body().querySelector('[data-send-backup-status]');
    if (status) {
      status.hidden = false;
      status.textContent = 'Generando respaldo de SA…';
    }
    try {
      let backupData;
      if (typeof window.generateNativeSaBackupData === 'function') {
        backupData = await window.generateNativeSaBackupData();
      } else {
        throw new Error('Generador nativo de backup no disponible.');
      }
      const jsonText = JSON.stringify(backupData, null, 2);
      const bytes = new TextEncoder().encode(jsonText);
      if (status) status.textContent = `Enviando respaldo (${(bytes.byteLength / (1024 * 1024)).toFixed(2)} MB)…`;

      await p2pBackupBridge.sendBackupOnChannel(channel, {
        bytes,
        schema: 'sa-backup/v1',
        onProgress: pct => {
          if (status) status.textContent = `Enviando respaldo… ${Math.round(pct * 100)}%`;
        }
      });

      if (status) {
        status.classList.add('is-success');
        status.innerHTML = `<strong>${p2pIcon('link', 15)} Respaldo enviado y validado</strong><br><span>El otro SA recibió y verificó la integridad del respaldo.</span>`;
      }
      notify('Respaldo enviado exitosamente.', 'success');
    } catch (err) {
      if (status) {
        status.classList.add('is-error');
        status.innerHTML = `<strong>Error:</strong> ${esc(err.message || err)}`;
      }
      notify(err.message || err, 'error');
    }
  });

  body().querySelector('[data-done]').addEventListener('click', renderHome);
  signalPairLinkedFeedback();
}

async function connectTrustedAndSendBackup(peerId) {
  cleanupSession();
  try {
    const identityStore = store();
    const self = await identityStore.getSelf();
    const peer = await identityStore.getPeer(peerId);
    if (!peer || (peer.peerApp !== 'sa' && peer.peerApp !== 'mini')) throw new Error('Dispositivo vinculado no encontrado.');
    activePeer = peer;
    const humanPeer = peerName(peer);
    setBodyHtml(`
      <div class="sa-p2p-step">
        ${backButton()}
        <div>
          <h3>Enviar respaldo a ${esc(humanPeer)}</h3>
          <p>Se enviará el respaldo nativo completo directamente por el canal autenticado.</p>
        </div>
        <div class="sa-p2p-status" data-backup-connect-status>Conectando con ${esc(humanPeer)}…</div>
      </div>`);

    body().querySelector('[data-back]').addEventListener('click', () => {
      cleanupSession();
      renderHome();
    });

    const route = await window.SaMiniP2P.deriveTrustedRoute(peer.linkToken);
    const signaling = new window.SaMiniP2P.SignalingClient({ room: route.room, peerId: self.deviceId, proof: route.proof });
    const isSame = peer.peerApp === self.appType;

    let sendStarted = false;
    activeSession = await window.SaMiniP2P.createRtcSession({
      signaling,
      initiator: true,
      onState: (status, error) => {
        const box = body()?.querySelector('[data-backup-connect-status]');
        if (box && error) box.textContent = 'Error: ' + error.message;
      },
      onChannel: channel => {
        activeChannel = channel;
        window.SaMiniP2PPairing.attachTrusted(channel, {
          self,
          peer,
          store: identityStore,
          allowSameApp: isSame,
          onAuthenticated: async () => {
            scheduleSaP2PHeaderRefresh();
            if (sendStarted) return;
            sendStarted = true;
            const status = body()?.querySelector('[data-backup-connect-status]');
            if (status) status.textContent = `${humanPeer} autenticado. Generando respaldo…`;
            try {
              let backupData;
              if (typeof window.generateNativeSaBackupData === 'function') {
                backupData = await window.generateNativeSaBackupData();
              } else {
                throw new Error('Generador nativo de backup no disponible.');
              }
              const jsonText = JSON.stringify(backupData, null, 2);
              const bytes = new TextEncoder().encode(jsonText);
              if (status) status.textContent = `Enviando respaldo (${(bytes.byteLength / (1024 * 1024)).toFixed(2)} MB)…`;

              await p2pBackupBridge.sendBackupOnChannel(channel, {
                bytes,
                schema: 'sa-backup/v1',
                onProgress: pct => {
                  if (status) status.textContent = `Enviando respaldo… ${Math.round(pct * 100)}%`;
                }
              });

              if (status) {
                status.classList.add('is-success');
                status.innerHTML = `<strong>${p2pIcon('link', 15)} Respaldo enviado y validado por ${esc(humanPeer)}</strong><br><span>El receptor recibió y verificó la integridad del respaldo (SHA-256).</span>`;
              }
              notify('Respaldo enviado y validado exitosamente.', 'success');
            } catch (sendErr) {
              if (status) {
                status.classList.add('is-error');
                status.innerHTML = `<strong>Error:</strong> ${esc(sendErr.message || sendErr)}`;
              }
              notify(sendErr.message || sendErr, 'error');
            }
          },
          onError: error => {
            const box = body()?.querySelector('[data-backup-connect-status]');
            if (box) box.textContent = 'Autenticación falló: ' + error.message;
          }
        });
      }
    });
  } catch (error) {
    notify(error.message || error, 'error');
    renderHome();
  }
}

async function connectTrustedAndReceiveBackup(peerId) {
  cleanupSession();
  try {
    const identityStore = store();
    const self = await identityStore.getSelf();
    const peer = await identityStore.getPeer(peerId);
    if (!peer || (peer.peerApp !== 'sa' && peer.peerApp !== 'mini')) throw new Error('Dispositivo vinculado no encontrado.');
    activePeer = peer;
    const humanPeer = peerName(peer);
    setBodyHtml(`
      <div class="sa-p2p-step">
        ${backButton()}
        <div>
          <h3>Esperar respaldo de ${esc(humanPeer)}</h3>
          <p>Esperando conexión y transferencia de respaldo por el canal cifrado.</p>
        </div>
        <div class="sa-p2p-status" data-backup-receive-status>Conectando con ${esc(humanPeer)}…</div>
      </div>`);

    body().querySelector('[data-back]').addEventListener('click', () => {
      cleanupSession();
      renderHome();
    });

    const route = await window.SaMiniP2P.deriveTrustedRoute(peer.linkToken);
    const signaling = new window.SaMiniP2P.SignalingClient({ room: route.room, peerId: self.deviceId, proof: route.proof });
    const isSame = peer.peerApp === self.appType;

    let receiverAttached = false;
    activeSession = await window.SaMiniP2P.createRtcSession({
      signaling,
      initiator: false,
      onState: (status, error) => {
        const box = body()?.querySelector('[data-backup-receive-status]');
        if (box && error) box.textContent = 'Error: ' + error.message;
      },
      onChannel: channel => {
        activeChannel = channel;
        window.SaMiniP2PPairing.attachTrusted(channel, {
          self,
          peer,
          store: identityStore,
          allowSameApp: isSame,
          onAuthenticated: () => {
            scheduleSaP2PHeaderRefresh();
            if (receiverAttached) return;
            receiverAttached = true;
            const status = body()?.querySelector('[data-backup-receive-status]');
            if (status) status.textContent = `${humanPeer} autenticado. Esperando envío de respaldo…`;
            p2pBackupBridge.createBackupReceiver({
              channel,
              peer,
              onProgress: pct => {
                const box = body()?.querySelector('[data-backup-receive-status]');
                if (box) box.textContent = `Recibiendo respaldo… ${Math.round(pct * 100)}%`;
              },
              onStaged: (staged) => {
                scheduleSaP2PHeaderRefresh();
                const box = body()?.querySelector('[data-backup-receive-status]');
                if (box) {
                  box.classList.remove('is-error');
                  box.classList.add('is-success');
                  const sizeMb = (staged.size / (1024 * 1024)).toFixed(2);
                  box.innerHTML = `<strong>${p2pIcon('backup', 15)} Respaldo recibido y validado</strong><br><span>Tamaño: ${sizeMb} MB · SHA-256 verificado. Quedó guardado en pendientes de revisión.</span>`;
                }
                notify('Respaldo recibido y validado exitosamente.', 'success');
              },
              onRejected: ({ reason }) => {
                const box = body()?.querySelector('[data-backup-receive-status]');
                if (box) {
                  box.classList.add('is-error');
                  box.innerHTML = `<strong>Respaldo rechazado:</strong> ${esc(reason)}`;
                }
                notify(`Respaldo rechazado: ${reason}`, 'warning');
              },
              onError: err => {
                const box = body()?.querySelector('[data-backup-receive-status]');
                if (box) {
                  box.classList.add('is-error');
                  box.innerHTML = `<strong>Error de recepción:</strong> ${esc(err.message || err)}`;
                }
                notify(err.message || err, 'error');
              }
            });
          },
          onError: error => {
            const box = body()?.querySelector('[data-backup-receive-status]');
            if (box) box.textContent = 'Autenticación falló: ' + error.message;
          }
        });
      }
    });
  } catch (error) {
    notify(error.message || error, 'error');
    renderHome();
  }
}

async function openPeerBackupSurface(peerId) {
  cleanupSession();
  try {
    const identityStore = store();
    const peer = await identityStore.getPeer(peerId);
    if (!peer) throw new Error('Dispositivo vinculado no encontrado.');
    activePeer = peer;
    const humanPeer = peerName(peer);
    const isMini = peer.peerApp === 'mini';

    const infoNote = isMini
      ? '<div class="sa-p2p-status">Transferencia de respaldos con Mini. Los respaldos que envíe este Mini se guardarán de forma segura para descarga local (Mini conserva su propia restauración nativa).</div>'
      : '<div class="sa-p2p-status">Transferencia de respaldos con SA. Los respaldos de SA recibidos pueden revisarse y restaurarse tras confirmación explícita.</div>';

    setBodyHtml(`
      <div class="sa-p2p-step">
        ${backButton()}
        <div>
          <h3>Respaldos con ${esc(humanPeer)}</h3>
          <p>Transferencia punto a punto de respaldos por el canal cifrado.</p>
        </div>
        ${infoNote}
        <div class="sa-p2p-actions">
          ${button('Enviar respaldo', 'data-action-send-backup', 'primary', 'backup')}
          ${button('Esperar respaldo', 'data-action-wait-backup', 'secondary', 'download')}
        </div>
      </div>`);

    body().querySelector('[data-back]').addEventListener('click', renderHome);
    body().querySelector('[data-action-send-backup]').addEventListener('click', () => {
      connectTrustedAndSendBackup(peer.peerId);
    });
    body().querySelector('[data-action-wait-backup]').addEventListener('click', () => {
      connectTrustedAndReceiveBackup(peer.peerId);
    });
  } catch (error) {
    notify(error.message || error, 'error');
    renderHome();
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
  window.refreshSaP2PHeaderIndicator = refreshSaP2PHeaderIndicator;
  if (!headerIndicatorListenerAttached) {
    eventBus.on('render:complete', () => scheduleSaP2PHeaderRefresh());
    headerIndicatorListenerAttached = true;
  }
  const presenceMgr = getP2PPresenceManager();
  presenceMgr.start();
  presenceMgr.on('change', () => scheduleSaP2PHeaderRefresh());
  scheduleSaP2PHeaderRefresh();
  if (!projectSetupListenerAttached) {
    window.addEventListener('projects:setup-changed', () => {
      if (modal()) renderHome().catch(error => notify(error.message || error, 'error'));
    });
    projectSetupListenerAttached = true;
  }
}
