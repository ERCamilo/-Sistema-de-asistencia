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
        this.active = { operation, employeeId, trigger, viewer, url: null };
        viewer.querySelector('button[data-employee-photo-viewer-close]').focus();

        let cached;
        try {
            cached = typeof this.photoStore.getEmployeeOriginal === 'function'
                ? await this.photoStore.getEmployeeOriginal(employeeId)
                : await this.photoStore.getEmployeePhoto(employeeId);
        } catch {
            if (this.active?.operation === operation) this.close();
            return false;
        }

        if (this.active?.operation !== operation) return false;
        if (!trigger.isConnected || String(trigger.dataset.employeePhotoVersion || '') !== expectedVersion) {
            this.close({ restoreFocus: false });
            return false;
        }
        if (!(cached?.optimizedBlob instanceof Blob)) {
            resetEmployeeAvatarToInitials(trigger);
            this.close();
            return false;
        }
        if (expectedVersion && String(cached.version) !== expectedVersion) {
            this.close();
            return false;
        }

        let objectUrl;
        try {
            objectUrl = this.urlApi.createObjectURL(cached.optimizedBlob);
        } catch {
            this.close();
            return false;
        }
        if (this.active?.operation !== operation || !trigger.isConnected) {
            this.urlApi.revokeObjectURL(objectUrl);
            return false;
        }

        this.active.url = objectUrl;
        const image = viewer.querySelector('[data-employee-photo-viewer-image]');
        image.addEventListener('error', () => {
            if (this.active?.operation === operation) this.close();
        }, { once: true });
        image.src = objectUrl;
        image.hidden = false;
        viewer.querySelector('[data-employee-photo-viewer-loading]').hidden = true;
        return true;
    }

    async refresh() {
        const active = this.active;
        if (!active || typeof this.photoStore.refreshEmployeePhoto !== 'function') return false;
        const button = active.viewer.querySelector('[data-employee-photo-action="update"]');
        const status = active.viewer.querySelector('[data-employee-photo-viewer-status]');
        if (!button || button.disabled) return false;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        status.textContent = 'Buscando una versión más reciente…';

        let result;
        try {
            result = await this.photoStore.refreshEmployeePhoto(active.employeeId);
        } catch {
            result = { status: 'error' };
        }
        if (this.active !== active) return false;

        if (result?.status === 'updated' && result.record?.optimizedBlob instanceof Blob) {
            try {
                const objectUrl = this.urlApi.createObjectURL(result.record.optimizedBlob);
                const previousUrl = active.url;
                active.url = objectUrl;
                active.viewer.querySelector('[data-employee-photo-viewer-image]').src = objectUrl;
                if (previousUrl) this.urlApi.revokeObjectURL(previousUrl);
                await hydrateEmployeeAvatars(active.viewer.ownerDocument, {
                    photoStore: this.photoStore,
                    urlApi: this.urlApi
                });
                status.textContent = 'La foto fue actualizada.';
            } catch {
                status.textContent = 'No se pudo actualizar la foto.';
            }
        } else if (result?.status === 'current') {
            status.textContent = 'La foto ya está actualizada.';
        } else if (result?.status === 'deleted') {
            resetEmployeeAvatarToInitials(active.trigger);
            this.close();
            return true;
        } else {
            status.textContent = 'No se pudo actualizar la foto. La copia guardada se mantuvo.';
        }
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.focus();
        return result?.status === 'updated' || result?.status === 'current';
    }

    close({ restoreFocus = true } = {}) {
        const active = this.active;
        if (!active) return false;
        this.active = null;
        if (active.url) this.urlApi.revokeObjectURL(active.url);
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
        const update = event.target.closest?.('[data-employee-photo-action="update"]');
        if (update && root.contains(update)) {
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
