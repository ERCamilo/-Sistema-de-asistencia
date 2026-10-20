import * as policy from '../config/AppVersion.js';
import { createReleaseManager } from '../services/AppUpdateManager.js';
import { Modal } from '../components/Modal.js';
import { isSettingsDraftDirty } from './settings/SettingsDraftBar.js';
import { saveApplicationData } from '../services/PersistenceService.js';

let manager = null;
function hasOtherDialog() {
    return [...document.querySelectorAll('.modal-overlay, [data-modal-overlay], #onboarding-preview-overlay')]
        .some(el => el.id !== 'update-modal' && !el.hasAttribute('data-modal-closing'));
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
    const target = document.querySelector('#update-modal [data-release-status]') || document.getElementById('app-update-status');
    if (target) target.textContent = message;
}
function show(kind, releases, version, close, apply) {
    const content = document.createElement('div'); content.className = 'release-notes';
    if (kind === 'update') { const hint = document.createElement('p'); hint.textContent = 'Actualiza cuando termines tu trabajo. Tus datos guardados se conservan.'; content.appendChild(hint); }
    for (const release of releases) {
        const section = document.createElement('section'), heading = document.createElement('h3'), date = document.createElement('p'), list = document.createElement('ul');
        heading.textContent = `${release.title} · v${release.version}`; date.textContent = release.date.split('-').reverse().join('/');
        for (const text of release.items) { const item = document.createElement('li'); item.textContent = text; list.appendChild(item); }
        section.append(heading, date, list); content.appendChild(section);
    }
    const message = document.createElement('p'); message.dataset.releaseStatus = ''; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); content.appendChild(message);
    const modal = new Modal({
        title: `${kind === 'news' ? 'Novedades' : 'Actualización disponible'} · v${version}`,
        content, size: 'medium', onClose: close,
        buttons: kind === 'news' ? [{ text: 'Entendido', class: 'btn-primary', onClick() { this.close(); } }] : [
            { text: 'Más tarde', class: 'btn-secondary', onClick() { this.close(); } },
            { text: 'Actualizar ahora', class: 'btn-primary', async onClick() {
                const button = this.element.querySelector('.btn-primary'); button.disabled = true;
                try { await apply(); } finally { button.disabled = false; }
            } }
        ]
    });
    modal.open(); modal.element.id = kind === 'news' ? 'whats-new-modal' : 'update-modal';
    modal.element.classList.add('release-modal'); return true;
}
async function refreshWorker() {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration(); if (!registration) return;
    await registration.update();
    const worker = registration.installing || registration.waiting;
    if (!worker || worker.state === 'activated') return;
    await new Promise((resolve, reject) => {
        const done = error => { clearTimeout(timer); worker.removeEventListener('statechange', check); error ? reject(error) : resolve(); };
        const check = () => { if (worker.state === 'activated') done(); else if (worker.state === 'redundant') done(new Error('Update failed')); };
        const timer = setTimeout(() => done(new Error('Update timeout')), 20000);
        worker.addEventListener('statechange', check); check();
    });
}
export function startAppUpdates() {
    if (manager) return manager;
    manager = createReleaseManager({
        policy, prefix: 'sa', read: key => localStorage.getItem(key), write: (key, value) => localStorage.setItem(key, value),
        now: () => Date.now(), online: () => navigator.onLine !== false, fetchRelease: fetchPublishedRelease,
        canShow: () => !hasOtherDialog() && !isSettingsDraftDirty(document) && !document.querySelector('input:focus, textarea:focus'),
        show, status, beforeReload: async () => {
            if (hasOtherDialog() || isSettingsDraftDirty(document)) throw new Error('Hay cambios sin guardar.');
            const saved = await saveApplicationData({ immediate: true, announce: false, requireLocalSuccess: true, localOnly: true });
            if (saved?.localOk !== true) throw new Error('No se pudo guardar.');
            await refreshWorker();
        }, reload: () => location.reload()
    });
    manager.boot();
    let hadController = !!navigator.serviceWorker?.controller;
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => {
        const previous = hadController; hadController = true; void manager.controllerChanged(previous);
    });
    const check = () => { if (document.visibilityState !== 'hidden') void manager.check(); };
    window.addEventListener('online', () => { void manager.check(false, true); });
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    setInterval(check, 60000); setInterval(() => manager.flush(), 1000); check();
    return manager;
}
export function openWhatsNew() { startAppUpdates().showNews(true); }
export function checkAppUpdates() { return startAppUpdates().check(true); }
