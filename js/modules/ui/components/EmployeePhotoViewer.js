import { employeePhotoService } from '../../services/EmployeePhotoService.js';
import { hydrateEmployeeAvatars, resetEmployeeAvatarToInitials } from './EmployeeAvatar.js';

const registrations = new WeakMap();
const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

function trapDialogFocus(event, dialog) {
    if (event.key !== 'Tab' || !dialog) return false;
    const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) {
        event.preventDefault();
        return true;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = dialog.ownerDocument.activeElement;
    if (focusable.length === 1) {
        event.preventDefault();
        first.focus();
    } else if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
    }
    return true;
}

function escapeAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function createViewer(documentRef, employeeId, name) {
    const viewer = documentRef.createElement('div');
    viewer.className = 'employee-photo-viewer';
    viewer.dataset.employeePhotoViewer = '';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', `Foto de ${name}`);
    viewer.innerHTML = `
        <div class="employee-photo-viewer__backdrop" data-employee-photo-viewer-backdrop
             data-employee-photo-viewer-close></div>
        <div class="employee-photo-viewer__content" data-employee-photo-viewer-content>
            <button class="employee-photo-viewer__close" type="button"
                    data-employee-photo-viewer-close aria-label="Cerrar foto">×</button>
            <div class="employee-photo-viewer__loading" data-employee-photo-viewer-loading
                 role="status">Cargando foto…</div>
            <img class="employee-photo-viewer__image" data-employee-photo-viewer-image
                 alt="" hidden>
            <div class="employee-photo-viewer__status" data-employee-photo-viewer-status
                 role="status" aria-live="polite"></div>
            <button class="employee-photo-viewer__retry" type="button"
                    data-employee-photo-viewer-retry hidden>Reintentar</button>
            <div class="employee-photo-viewer__actions" aria-label="Acciones de foto">
                <button type="button" data-employee-photo-action="change"
                        data-employee-id="${escapeAttribute(employeeId)}" data-employee-name="${escapeAttribute(name)}">Cambiar</button>
                <button type="button" data-employee-photo-action="update">Actualizar</button>
                <button type="button" data-employee-photo-action="delete"
                        data-employee-id="${escapeAttribute(employeeId)}" data-employee-name="${escapeAttribute(name)}">Eliminar</button>
            </div>
        </div>`;
    viewer.querySelector('[data-employee-photo-viewer-image]').alt = `Foto de ${name}`;
    documentRef.body.append(viewer);
    return viewer;
}

export class EmployeePhotoViewerController {
    constructor({ photoStore = employeePhotoService, urlApi = globalThis.URL } = {}) {
        this.photoStore = photoStore;
        this.urlApi = urlApi;
        this.active = null;
    }

    isOpen() {
        return !!this.active;
    }

    handleKeydown(event) {
        if (!this.active) return false;
        return trapDialogFocus(event, this.active.viewer);
    }

    async open(trigger) {
        if (!trigger?.hasAttribute('data-employee-photo-viewer-trigger')) return false;
        const employeeId = String(trigger.dataset.employeeId || '').trim();
        const name = String(trigger.dataset.employeeName || 'Empleado');
        const expectedVersion = String(trigger.dataset.employeePhotoVersion || '');
        if (!employeeId) return false;

        this.close({ restoreFocus: false });
        const operation = Symbol('employee-photo-viewer');
        const viewer = createViewer(trigger.ownerDocument, employeeId, name);
        viewer.employeePhotoRestoreTarget = trigger;
        this.active = { operation, employeeId, trigger, viewer, url: null, urls: new Set(), busy: false, pendingPhoto: null };
        viewer.querySelector('button[data-employee-photo-viewer-close]').focus();
        return this.loadOriginal(this.active, expectedVersion);
    }

    setBusy(active, busy) {
        active.busy = busy;
        for (const button of active.viewer.querySelectorAll('[data-employee-photo-action="update"], [data-employee-photo-viewer-retry]')) {
            button.disabled = busy;
            if (busy) button.setAttribute('aria-busy', 'true');
            else button.removeAttribute('aria-busy');
        }
        const retry = active.viewer.querySelector('[data-employee-photo-viewer-retry]');
        if (!busy && active.retryHadFocus && !retry.hidden && active.viewer.ownerDocument.activeElement === active.viewer.ownerDocument.body) retry.focus();
    }

    revoke(active, url) {
        if (active.urls.delete(url)) this.urlApi.revokeObjectURL(url);
    }

    showFailure(active, message) {
        if (this.active !== active) return;
        active.viewer.classList.add('employee-photo-viewer--unavailable');
        active.viewer.querySelector('[data-employee-photo-viewer-loading]').hidden = true;
        active.viewer.querySelector('[data-employee-photo-viewer-status]').textContent = message;
        active.viewer.querySelector('[data-employee-photo-viewer-retry]').hidden = false;
    }

    stagePhoto(active, cached, message = '', expectedVersion = String(active.trigger.dataset.employeePhotoVersion || '')) {
        const objectUrl = this.urlApi.createObjectURL(cached.optimizedBlob);
        if (active.pendingPhoto) this.revoke(active, active.pendingPhoto.url);
        active.urls.add(objectUrl);
        const image = active.viewer.ownerDocument.createElement('img');
        image.className = 'employee-photo-viewer__image';
        image.dataset.employeePhotoViewerImage = '';
        image.alt = active.viewer.querySelector('[data-employee-photo-viewer-image]').alt;
        const pending = { image, url: objectUrl, message };
        active.pendingPhoto = pending;
        const isCurrent = () => this.active === active && active.pendingPhoto === pending;
        image.addEventListener('load', () => {
            if (!isCurrent()) return;
            if (!active.trigger.isConnected) { this.close({ restoreFocus: false }); return; }
            if (String(active.trigger.dataset.employeePhotoVersion || '') !== expectedVersion) {
                active.pendingPhoto = null;
                this.revoke(active, objectUrl);
                this.showFailure(active, 'La foto cambió mientras se abría. Reintenta para ver la versión actual.');
                this.setBusy(active, false);
                return;
            }
            const retry = active.viewer.querySelector('[data-employee-photo-viewer-retry]');
            const restoreFocus = active.viewer.ownerDocument.activeElement === retry
                || (active.retryHadFocus && active.viewer.ownerDocument.activeElement === active.viewer.ownerDocument.body);
            active.viewer.querySelector('[data-employee-photo-viewer-image]').replaceWith(image);
            active.url = objectUrl;
            active.pendingPhoto = null;
            for (const url of [...active.urls]) if (url !== objectUrl) this.revoke(active, url);
            active.viewer.classList.remove('employee-photo-viewer--unavailable');
            active.viewer.querySelector('[data-employee-photo-viewer-loading]').hidden = true;
            active.viewer.querySelector('[data-employee-photo-viewer-status]').textContent = pending.message;
            retry.hidden = true;
            this.setBusy(active, false);
            if (restoreFocus) active.viewer.querySelector('[data-employee-photo-action="update"]').focus();
            active.retryHadFocus = false;
        }, { once: true });
        image.addEventListener('error', () => {
            if (!isCurrent()) return;
            active.pendingPhoto = null;
            this.revoke(active, objectUrl);
            this.showFailure(active, 'No se pudo mostrar la foto original. Puedes reintentar o cambiarla.');
            this.setBusy(active, false);
        }, { once: true });
        image.src = objectUrl;
    }

    async loadOriginal(active, expectedVersion = String(active.trigger.dataset.employeePhotoVersion || '')) {
        if (this.active !== active || active.busy) return false;
        this.setBusy(active, true);
        active.viewer.querySelector('[data-employee-photo-viewer-status]').textContent = 'Recuperando foto original…';
        try {
            const cached = typeof this.photoStore.getEmployeeOriginal === 'function'
                ? await this.photoStore.getEmployeeOriginal(active.employeeId)
                : await this.photoStore.getEmployeePhoto(active.employeeId);
            if (this.active !== active) return false;
            if (!active.trigger.isConnected) { this.close({ restoreFocus: false }); return false; }
            if (String(active.trigger.dataset.employeePhotoVersion || '') !== expectedVersion
                || (cached?.optimizedBlob instanceof Blob && expectedVersion && String(cached.version) !== expectedVersion)) {
                this.showFailure(active, 'La foto cambió mientras se abría. Reintenta para ver la versión actual.');
                return false;
            }
            if (!(cached?.optimizedBlob instanceof Blob)) {
                const message = globalThis.navigator?.onLine === false
                    ? 'Sin conexión. No se pudo recuperar la foto original. Reintenta cuando vuelva la conexión.'
                    : 'No se pudo recuperar la foto original. Puedes reintentar o cambiar la foto.';
                this.showFailure(active, message);
                return false;
            }
            this.stagePhoto(active, cached, '', expectedVersion);
            return true;
        } catch {
            this.showFailure(active, 'No se pudo abrir la foto original. Puedes reintentar o cambiarla.');
            return false;
        } finally {
            if (this.active === active && !active.pendingPhoto) this.setBusy(active, false);
        }
    }

    async retry() {
        const active = this.active;
        if (!active) return false;
        if (active.busy) return false;
        active.retryHadFocus = active.viewer.ownerDocument.activeElement === active.viewer.querySelector('[data-employee-photo-viewer-retry]');
        const loaded = await this.loadOriginal(active);
        if (this.active === active && !loaded && !active.busy) active.viewer.querySelector('[data-employee-photo-viewer-retry]').focus();
        return loaded;
    }

    async refresh() {
        const active = this.active;
        if (!active || active.busy || typeof this.photoStore.refreshEmployeePhoto !== 'function') return false;
        const button = active.viewer.querySelector('[data-employee-photo-action="update"]');
        const status = active.viewer.querySelector('[data-employee-photo-viewer-status]');
        this.setBusy(active, true);
        status.textContent = 'Buscando una versión más reciente…';
        let result;
        try {
            result = await this.photoStore.refreshEmployeePhoto(active.employeeId);
        } catch { result = { status: 'error' }; }
        if (this.active !== active) return false;

        if ((result?.status === 'updated' || result?.status === 'current') && result.record?.optimizedBlob instanceof Blob
            && (result.status === 'updated' || !active.url || active.viewer.classList.contains('employee-photo-viewer--unavailable'))) {
            let message = result.status === 'updated' ? 'La foto fue actualizada.' : 'La foto ya está actualizada.';
            try {
                await hydrateEmployeeAvatars(active.viewer.ownerDocument, { photoStore: this.photoStore, urlApi: this.urlApi });
            } catch { message = 'La foto está disponible; no se pudo refrescar su miniatura.'; }
            if (this.active !== active) return false;
            try { this.stagePhoto(active, result.record, message); }
            catch { this.showFailure(active, 'No se pudo mostrar la foto original. Puedes reintentar o cambiarla.'); }
        } else if (result?.status === 'current' && active.url) {
            status.textContent = 'La foto ya está actualizada.';
        } else if (result?.status === 'pending') {
            status.textContent = 'La foto se está sincronizando. Vuelve a actualizar en unos segundos.';
        } else if (result?.status === 'superseded') {
            status.textContent = 'La foto cambió mientras se actualizaba. Vuelve a actualizar.';
        } else if (result?.status === 'deleted') {
            resetEmployeeAvatarToInitials(active.trigger);
            this.close();
            return true;
        } else if (!active.url) {
            this.showFailure(active, 'No se pudo recuperar la foto original. Puedes reintentar o cambiar la foto.');
        } else {
            status.textContent = 'No se pudo actualizar la foto. La copia guardada se mantuvo.';
        }
        if (!active.pendingPhoto) this.setBusy(active, false);
        button.focus();
        return (result?.status === 'updated' || result?.status === 'current') && !!(active.url || active.pendingPhoto);
    }

    close({ restoreFocus = true } = {}) {
        const active = this.active;
        if (!active) return false;
        this.active = null;
        for (const url of [...active.urls]) this.revoke(active, url);
        active.viewer.remove();
        if (restoreFocus && active.trigger.isConnected) active.trigger.focus();
        return true;
    }
}

export const employeePhotoViewerController = new EmployeePhotoViewerController();

export function registerEmployeePhotoViewerEvents(
    root = document,
    controller = employeePhotoViewerController
) {
    if (registrations.has(root)) return registrations.get(root);
    const onClick = event => {
        const close = event.target.closest?.('[data-employee-photo-viewer-close]');
        const trigger = event.target.closest?.('[data-employee-photo-viewer-trigger]');
        const retry = event.target.closest?.('[data-employee-photo-viewer-retry]');
        const update = event.target.closest?.('[data-employee-photo-action="update"]');
        if (retry && root.contains(retry)) {
            event.preventDefault();
            event.stopPropagation();
            void controller.retry();
        } else if (update && root.contains(update)) {
            event.preventDefault();
            event.stopPropagation();
            void controller.refresh();
        } else if (close && root.contains(close)) {
            event.preventDefault();
            controller.close();
        } else if (trigger && root.contains(trigger)) {
            event.preventDefault();
            event.stopPropagation();
            void controller.open(trigger);
        }
    };
    const onKeydown = event => {
        if (event.key === 'Tab' && controller.isOpen()) {
            controller.handleKeydown?.(event);
            return;
        }
        if (event.key === 'Escape' && controller.isOpen()) {
            event.preventDefault();
            controller.close();
            return;
        }
        const trigger = event.target.closest?.('[data-employee-photo-viewer-trigger]');
        if (trigger && root.contains(trigger) && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            void controller.open(trigger);
        }
    };
    const onPhotoAction = () => controller.close({ restoreFocus: false });
    root.addEventListener('click', onClick, true);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('employee-photo:action-started', onPhotoAction);
    const cleanup = () => {
        root.removeEventListener('click', onClick, true);
        root.removeEventListener('keydown', onKeydown);
        root.removeEventListener('employee-photo:action-started', onPhotoAction);
        controller.close({ restoreFocus: false });
        registrations.delete(root);
    };
    registrations.set(root, cleanup);
    return cleanup;
}
