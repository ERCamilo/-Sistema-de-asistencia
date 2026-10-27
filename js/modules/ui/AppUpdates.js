import * as policy from '../config/AppVersion.js';
import { createReleaseManager } from '../services/AppUpdateManager.js';
import { createAppUpdateWorker, withUpdateDeadline } from '../services/AppUpdateWorker.js';
import { Modal } from '../components/Modal.js';
import { logError } from '../services/ErrorLog.js';
import { isSettingsDraftDirty } from './settings/SettingsDraftBar.js';
import { saveApplicationData } from '../services/PersistenceService.js';

let manager = null, repairModal = null, lastStatus = '';
const ownDialogs = new Set(['update-modal', 'interface-repair-modal']);
function hasOtherDialog() {
    return [...document.querySelectorAll('.modal-overlay, [data-modal-overlay], #onboarding-preview-overlay')]
        .some(el => !ownDialogs.has(el.id) && !el.hasAttribute('data-modal-closing'));
}
export async function fetchPublishedRelease() {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
        const url = new URL('./app-release.json', document.baseURI); url.searchParams.set('__incoming', Date.now());
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Release unavailable');
        const content = await response.text(); if (content.length > 150000) throw new Error('Release too large');
        return JSON.parse(content);
    } finally { clearTimeout(timer); }
}
function status(message) {
    lastStatus = message;
    const target = document.querySelector('#interface-repair-modal [data-release-status]')
        || document.querySelector('#update-modal [data-release-status]') || document.getElementById('app-update-status');
    if (target) target.textContent = message;
}
function updateControls(state) {
    const modal = document.querySelector('#update-modal');
    if (modal) {
        const primary = modal.querySelector('[data-release-apply]'), reload = modal.querySelector('[data-release-reload]');
        if (primary) {
            primary.disabled = state.busy || state.phase === 'preparing';
            primary.textContent = state.busy ? 'Actualizando…' : state.phase === 'preparing' ? 'Preparando…'
                : state.phase === 'error' ? 'Reintentar' : 'Actualizar ahora';
        }
        if (reload) { reload.hidden = state.phase !== 'error'; reload.disabled = state.busy; }
        modal.setAttribute('aria-busy', String(state.busy || state.phase === 'preparing'));
    }
    if (repairModal?.isOpen) {
        const primary = repairModal.element.querySelector('[data-repair-apply]');
        if (primary) { primary.disabled = state.busy; primary.textContent = state.busy ? 'Reparando…' : 'Reparar y recargar'; }
        const reload = repairModal.element.querySelector('[data-release-reload]');
        if (reload) { reload.hidden = state.busy || !/^No se pudo|tardó demasiado/.test(lastStatus); reload.disabled = state.busy; }
        repairModal.element.setAttribute('aria-busy', String(state.busy));
    }
}
function addStatus(content) {
    const message = document.createElement('p'); message.dataset.releaseStatus = '';
    message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); content.appendChild(message);
    return message;
}
function decorate(modal, id, regionLabel) {
    modal.open(); modal.element.id = id; modal.element.classList.add('release-modal');
    const body = modal.element.querySelector('.modal-body'); body.tabIndex = 0;
    body.setAttribute('role', 'region'); body.setAttribute('aria-label', regionLabel);
}
function show(kind, releases, version, close, apply) {
    const content = document.createElement('div'); content.className = 'release-notes';
    if (kind === 'update') {
        const hint = document.createElement('p');
        hint.textContent = 'La nueva versión se prepara sin interrumpir tu trabajo. Al actualizar se guardarán tus datos.';
        content.appendChild(hint);
    }
    for (const release of releases) {
        const section = document.createElement('section'), heading = document.createElement('h3');
        const date = document.createElement('p'), list = document.createElement('ul');
        heading.textContent = `${release.title} · v${release.version}`; date.textContent = release.date.split('-').reverse().join('/');
        for (const text of release.items) { const item = document.createElement('li'); item.textContent = text; list.appendChild(item); }
        section.append(heading, date, list); content.appendChild(section);
    }
    const message = addStatus(content);
    const modal = new Modal({
        title: `${kind === 'news' ? 'Novedades' : 'Actualización disponible'} · v${version}`,
        content, size: 'medium', onClose: close,
        buttons: kind === 'news' ? [{ text: 'Entendido', class: 'btn-primary', onClick() { this.close(); } }] : [
            { text: 'Más tarde', class: 'btn-secondary', onClick() { this.close(); } },
            { text: 'Recargar', class: 'btn-secondary release-reload', onClick() { void manager.reloadSafely(); } },
            { text: 'Preparando…', class: 'btn-primary', onClick() { void apply(); } }
        ]
    });
    decorate(modal, kind === 'news' ? 'whats-new-modal' : 'update-modal',
        kind === 'news' ? 'Novedades de las versiones' : 'Detalles de la actualización');
    if (kind === 'update') {
        modal.element.querySelector('.btn-primary').dataset.releaseApply = '';
        modal.element.querySelector('.release-reload').dataset.releaseReload = '';
        message.textContent = manager?.getState().message || '';
        updateControls(manager.getState());
    }
    return true;
}
async function beforeReload() {
    if (hasOtherDialog() || isSettingsDraftDirty(document)) {
        const error = new Error('Guarda o cierra los cambios pendientes antes de recargar.'); error.code = 'changes-pending'; throw error;
    }
    const saved = await withUpdateDeadline(() => saveApplicationData({
        immediate: true, announce: false, requireLocalSuccess: true, localOnly: true
    }), { timeoutMs: 15000 });
    if (saved?.localOk !== true) throw new Error('No se pudo guardar.');
}
export function startAppUpdates() {
    if (manager) return manager;
    const worker = createAppUpdateWorker();
    manager = createReleaseManager({
        policy, prefix: 'sa', read: key => localStorage.getItem(key), write: (key, value) => localStorage.setItem(key, value),
        now: () => Date.now(), online: () => navigator.onLine !== false, fetchRelease: fetchPublishedRelease,
        canShow: () => !hasOtherDialog() && !repairModal?.isOpen && !isSettingsDraftDirty(document) && !document.querySelector('input:focus, textarea:focus'),
        canReload: () => !hasOtherDialog() && !isSettingsDraftDirty(document),
        show, status, updateState: updateControls, beforeReload, reportError: logError,
        prepareRelease: worker.prepare, activateRelease: worker.activate, reload: () => location.reload()
    });
    manager.boot(); void worker.confirmRunningVersion(policy.APP_VERSION);
    let hadController = !!navigator.serviceWorker?.controller;
    const watched = new WeakSet();
    const watch = registration => {
        if (!registration || watched.has(registration)) return;
        watched.add(registration);
        registration.addEventListener('updatefound', () => { void manager.check(false, true); });
    };
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            const previous = hadController; hadController = true; void manager.controllerChanged(previous);
        });
        navigator.serviceWorker.ready?.then(watch).catch(() => {});
        navigator.serviceWorker.getRegistration().then(watch).catch(() => {});
    }
    const check = () => { if (document.visibilityState !== 'hidden') void manager.check(); };
    window.addEventListener('online', () => { void manager.check(false, true); });
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    setInterval(check, 60000); setInterval(() => manager.flush(), 1000); check();
    return manager;
}
export function openWhatsNew() { startAppUpdates().showNews(true); }
export function checkAppUpdates() { return startAppUpdates().check(true); }
export function openInterfaceRepair() {
    const releaseManager = startAppUpdates();
    if (repairModal?.isOpen || document.querySelector('#update-modal:not([data-modal-closing]), #whats-new-modal:not([data-modal-closing])')) return;
    if (hasOtherDialog() || isSettingsDraftDirty(document)) {
        status('Guarda o cierra los cambios pendientes antes de reparar la interfaz.'); return;
    }
    const content = document.createElement('div'); content.className = 'release-notes';
    const hint = document.createElement('p');
    hint.textContent = 'Renueva los archivos de la aplicación y recarga. Conserva tus datos, fotos y comprobantes.';
    content.appendChild(hint); addStatus(content);
    repairModal = new Modal({
        title: 'Reparar interfaz', content, size: 'small',
        onClose: () => releaseManager.cancelOperation(),
        buttons: [
            { text: 'Cancelar', class: 'btn-secondary', onClick() { this.close(); } },
            { text: 'Recargar', class: 'btn-secondary release-reload', onClick() { void releaseManager.reloadSafely(); } },
            { text: 'Reparar y recargar', class: 'btn-primary', onClick() { void releaseManager.repair(); } }
        ]
    });
    decorate(repairModal, 'interface-repair-modal', 'Reparación de la interfaz');
    repairModal.element.querySelector('.btn-primary').dataset.repairApply = '';
    repairModal.element.querySelector('.release-reload').dataset.releaseReload = '';
    lastStatus = ''; updateControls(releaseManager.getState());
}
