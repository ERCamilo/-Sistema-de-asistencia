import { processEmployeePhoto } from '../../features/employees/EmployeePhotoProcessor.js';
import { employeePhotoService } from '../../services/EmployeePhotoService.js';
import { EmployeeAvatar, hydrateEmployeeAvatars } from './EmployeeAvatar.js';

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
        dialog.focus();
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

export function EmployeePhotoAcquisitionUI(employee = {}, { avatarHtml = '' } = {}) {
    const name = String(employee.name || 'Empleado').trim() || 'Empleado';
    const safeName = escapeAttribute(name);
    const employeeId = escapeAttribute(employee.id);
    const resolvedAvatarHtml = avatarHtml || EmployeeAvatar(employee, { variant: 'compact' });
    return `
        <div class="employee-avatar-control">
            ${resolvedAvatarHtml}
        </div>
        <div class="employee-photo-sheet" data-employee-photo-sheet data-employee-id="${employeeId}"
             data-employee-name="${safeName}"
             role="dialog" aria-modal="true" aria-label="Cambiar foto de ${safeName}"
             tabindex="-1" hidden>
            <div class="employee-photo-sheet__panel">
                <strong class="employee-photo-sheet__title">Foto del empleado</strong>
                <p class="employee-photo-sheet__status" data-employee-photo-status aria-live="polite" hidden>
                    Procesando foto…
                </p>
                <p class="employee-photo-sheet__error" data-employee-photo-error role="alert" hidden>
                    No se pudo guardar la foto. Inténtalo de nuevo.
                </p>
                <button type="button" data-employee-photo-action="camera">Tomar foto</button>
                <button type="button" data-employee-photo-action="gallery">Elegir de la galería</button>
                <button type="button" data-employee-photo-action="cancel">Cancelar</button>
                <input type="file" accept="image/*" capture="environment"
                       data-employee-photo-input="camera" hidden>
                <input type="file" accept="image/*" data-employee-photo-input="gallery" hidden>
            </div>
        </div>`;
}

function createDynamicSheet(trigger) {
    const employee = {
        id: trigger.dataset.employeeId,
        name: trigger.dataset.employeeName || 'Empleado'
    };
    const host = trigger.ownerDocument.createElement('div');
    host.dataset.employeePhotoDynamicHost = '';
    host.innerHTML = EmployeePhotoAcquisitionUI(employee);
    trigger.ownerDocument.body.append(host);
    return host.querySelector('[data-employee-photo-sheet]');
}

function sheetFor(element) {
    return element?.closest?.('[data-employee-photo-sheet]')
        || element?.closest?.('.floating-card')?.querySelector('[data-employee-photo-sheet]')
        || null;
}

function clearInputs(sheet) {
    sheet.querySelectorAll('[data-employee-photo-input]').forEach(input => { input.value = ''; });
}

function setBusy(sheet, busy) {
    sheet.setAttribute('aria-busy', String(busy));
    sheet.querySelector('[data-employee-photo-status]').hidden = !busy;
    sheet.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    if (busy) sheet.focus();
}

function hideError(sheet) {
    const error = sheet.querySelector('[data-employee-photo-error]');
    error.hidden = true;
    error.textContent = 'No se pudo guardar la foto. Inténtalo de nuevo.';
}

export class EmployeePhotoAcquisitionController {
    constructor({
        processPhoto = processEmployeePhoto,
        photoStore = employeePhotoService,
        hydrateAvatars = hydrateEmployeeAvatars,
        confirmDelete = message => globalThis.confirm?.(message) ?? false
    } = {}) {
        this.processPhoto = processPhoto;
        this.photoStore = photoStore;
        this.hydrateAvatars = hydrateAvatars;
        this.confirmDelete = confirmDelete;
        this.processing = new WeakSet();
        this.openers = new WeakMap();
        this.latestOperations = new Map();
        this.writeQueues = new Map();
        this.openSheets = new Set();
    }

    closeSheet(sheet) {
        if (!sheet) return false;
        clearInputs(sheet);
        hideError(sheet);
        sheet.hidden = true;
        this.openSheets.delete(sheet);
        const opener = this.openers.get(sheet);
        this.openers.delete(sheet);
        sheet.closest('[data-employee-photo-dynamic-host]')?.remove();
        this.restoreFocus(sheet, opener);
        return true;
    }

    restoreFocus(sheet, opener) {
        if (opener?.isConnected) {
            opener.focus();
            return opener;
        }
        const employeeId = String(sheet?.dataset.employeeId || '').trim();
        const replacement = [...sheet?.ownerDocument?.querySelectorAll?.('[data-employee-avatar]') || []]
            .find(element => element.dataset.employeeId === employeeId && element.isConnected);
        if (replacement) {
            replacement.focus();
            return replacement;
        }
        const body = sheet?.ownerDocument?.body;
        if (body) {
            const hadTabIndex = body.hasAttribute('tabindex');
            const previousTabIndex = body.getAttribute('tabindex');
            body.tabIndex = -1;
            body.focus();
            if (hadTabIndex) body.setAttribute('tabindex', previousTabIndex);
            else body.removeAttribute('tabindex');
        }
        return body || null;
    }

    stableOpener(element) {
        const viewerOrigin = element?.closest?.('[data-employee-photo-viewer]')
            ?.employeePhotoRestoreTarget;
        return viewerOrigin?.isConnected ? viewerOrigin : element;
    }

    handleKeydown(event, sheet = null) {
        sheet = sheet
            || sheetFor(event.target)
            || [...this.openSheets].find(candidate => candidate.isConnected && !candidate.hidden)
            || null;
        if (!sheet || sheet.hidden) return false;
        if (event.key === 'Tab') return trapDialogFocus(event, sheet);
        if (this.processing.has(sheet)) return false;
        if (event.key === 'Escape') {
            event.preventDefault();
            return this.closeSheet(sheet);
        }
        return false;
    }

    handleAction(action, element) {
        let sheet = sheetFor(element);
        if (!sheet && ['open', 'change', 'delete'].includes(action)) {
            sheet = createDynamicSheet(element);
        }
        if (!sheet || this.processing.has(sheet)) return false;
        if (action === 'open' || action === 'change') {
            this.openers.set(sheet, this.stableOpener(element));
            this.openSheets.add(sheet);
            hideError(sheet);
            setBusy(sheet, false);
            sheet.hidden = false;
            sheet.querySelector('[data-employee-photo-action="camera"]')?.focus();
            element.dispatchEvent(new CustomEvent('employee-photo:action-started', { bubbles: true }));
            return true;
        }
        if (action === 'cancel') {
            return this.closeSheet(sheet);
        }
        if (action === 'delete') {
            void this.deletePhoto(sheet, element);
            return true;
        }
        const input = sheet.querySelector(`[data-employee-photo-input="${action}"]`);
        if (input) {
            input.click();
            return true;
        }
        return false;
    }

    async deletePhoto(sheet, opener = null) {
        const employeeId = String(sheet.dataset.employeeId || '').trim();
        if (!employeeId || this.processing.has(sheet)) return false;
        const employeeName = String(sheet.dataset.employeeName || opener?.dataset.employeeName || 'este empleado');
        if (!this.confirmDelete(`¿Eliminar la foto de ${employeeName}? Se borrará de este dispositivo y de la nube.`)) {
            sheet.closest('[data-employee-photo-dynamic-host]')?.remove();
            return false;
        }
        opener?.dispatchEvent(new CustomEvent('employee-photo:action-started', { bubbles: true }));
        const restoreTarget = [...sheet.ownerDocument.querySelectorAll('[data-employee-avatar]')]
            .find(element => element.dataset.employeeId === employeeId);
        this.processing.add(sheet);
        hideError(sheet);
        setBusy(sheet, true);
        try {
            await this.photoStore.deleteEmployeePhoto(employeeId);
            sheet.hidden = true;
            this.openSheets.delete(sheet);
            this.openers.get(sheet)?.focus();
            this.openers.delete(sheet);
            await this.hydrateMatchingAvatars(employeeId, sheet.ownerDocument);
            restoreTarget?.focus();
            sheet.closest('[data-employee-photo-dynamic-host]')?.remove();
            return true;
        } catch {
            sheet.hidden = false;
            sheet.querySelector('[data-employee-photo-error]').textContent =
                'No se pudo eliminar la foto. Inténtalo de nuevo.';
            sheet.querySelector('[data-employee-photo-error]').hidden = false;
            return false;
        } finally {
            this.processing.delete(sheet);
            setBusy(sheet, false);
        }
    }

    async handleInput(input) {
        const sheet = sheetFor(input);
        const file = input.files?.[0];
        if (!sheet || !file || this.processing.has(sheet)) {
            if (!file) input.value = '';
            return false;
        }

        const employeeId = String(sheet.dataset.employeeId || '').trim();
        const operation = Symbol('employee-photo-operation');
        this.latestOperations.set(employeeId, operation);
        this.processing.add(sheet);
        hideError(sheet);
        setBusy(sheet, true);
        try {
            const processed = await this.processPhoto(file);
            const saved = await this.commitLatest(employeeId, operation, processed);
            if (!saved || this.latestOperations.get(employeeId) !== operation) return false;
            clearInputs(sheet);
            sheet.hidden = true;
            this.openSheets.delete(sheet);
            this.openers.get(sheet)?.focus();
            this.openers.delete(sheet);
            await this.hydrateMatchingAvatars(employeeId, sheet.ownerDocument);
            sheet.closest('[data-employee-photo-dynamic-host]')?.remove();
            return true;
        } catch {
            if (this.latestOperations.get(employeeId) === operation) {
                sheet.querySelector('[data-employee-photo-error]').hidden = false;
            }
            return false;
        } finally {
            input.value = '';
            this.processing.delete(sheet);
            setBusy(sheet, false);
            if (this.latestOperations.get(employeeId) === operation) {
                this.latestOperations.delete(employeeId);
            }
        }
    }

    async commitLatest(employeeId, operation, processed) {
        const previous = this.writeQueues.get(employeeId) || Promise.resolve();
        const commit = previous.catch(() => {}).then(async () => {
            if (this.latestOperations.get(employeeId) !== operation) return false;
            await this.photoStore.replaceEmployeePhoto(employeeId, processed);
            return this.latestOperations.get(employeeId) === operation;
        });
        this.writeQueues.set(employeeId, commit);
        try {
            return await commit;
        } finally {
            if (this.writeQueues.get(employeeId) === commit) this.writeQueues.delete(employeeId);
        }
    }

    async hydrateMatchingAvatars(employeeId, documentRef) {
        const avatars = [...documentRef.querySelectorAll('[data-employee-avatar]')]
            .filter(element => element.dataset.employeeId === employeeId);
        try {
            await Promise.all(avatars.map(element => this.hydrateAvatars(element)));
        } catch { /* cache is already saved; a later render can hydrate it */ }
    }
}

export const employeePhotoAcquisitionController = new EmployeePhotoAcquisitionController();

export function registerEmployeePhotoAcquisitionEvents(
    root = document,
    controller = employeePhotoAcquisitionController
) {
    if (registrations.has(root)) return registrations.get(root);
    const onClick = event => {
        const sheetBackdrop = event.target?.matches?.('[data-employee-photo-sheet]')
            ? event.target
            : null;
        if (sheetBackdrop && root.contains(sheetBackdrop)) {
            event.preventDefault();
            event.stopPropagation();
            controller.handleAction('cancel', sheetBackdrop);
            return;
        }
        const acquisitionTrigger = event.target.closest?.('[data-employee-photo-acquisition-trigger]');
        const target = acquisitionTrigger || event.target.closest?.('[data-employee-photo-action]');
        if (!target || !root.contains(target)) return;
        event.preventDefault();
        event.stopPropagation();
        controller.handleAction(acquisitionTrigger ? 'open' : target.dataset.employeePhotoAction, target);
    };
    const onChange = event => {
        const input = event.target.closest?.('[data-employee-photo-input]');
        if (!input || !root.contains(input)) return;
        event.stopPropagation();
        void controller.handleInput(input);
    };
    const onKeydown = event => controller.handleKeydown?.(event);
    root.addEventListener('click', onClick, true);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKeydown);
    const cleanup = () => {
        root.removeEventListener('click', onClick, true);
        root.removeEventListener('change', onChange);
        root.removeEventListener('keydown', onKeydown);
        registrations.delete(root);
    };
    registrations.set(root, cleanup);
    return cleanup;
}
