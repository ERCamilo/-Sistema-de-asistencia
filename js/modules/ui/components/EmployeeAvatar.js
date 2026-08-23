import { employeePhotoService } from '../../services/EmployeePhotoService.js';

const activeAvatarUrls = new Map();
const hydrationTokens = new WeakMap();
const ALLOWED_VARIANTS = new Set(['default', 'compact']);

function escapeAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function accessibleEmployeeName(value) {
    const name = String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return name || 'Empleado';
}

export function EmployeeAvatar(employee = {}, { variant = 'default' } = {}) {
    const safeVariant = ALLOWED_VARIANTS.has(variant) ? variant : 'default';
    const name = accessibleEmployeeName(employee.name);
    return `
        <button class="employee-avatar employee-avatar--${safeVariant}" type="button"
              data-employee-avatar data-employee-id="${escapeAttribute(employee.id)}"
              data-employee-name="${escapeAttribute(name)}"
              data-employee-photo-acquisition-trigger
              role="button"
              aria-label="Agregar foto de ${escapeAttribute(name)}">
            <span class="employee-avatar__fallback" data-avatar-fallback aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path d="M9 4.5 10.4 3h3.2L15 4.5h2.75A2.25 2.25 0 0 1 20 6.75v9.5a2.25 2.25 0 0 1-2.25 2.25H6.25A2.25 2.25 0 0 1 4 16.25v-9.5A2.25 2.25 0 0 1 6.25 4.5H9Zm3 3.25a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 1.75a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5Z" fill="currentColor"/>
                </svg>
            </span>
            <img class="employee-avatar__image" data-avatar-image alt="" aria-hidden="true"
                 decoding="async" hidden>
        </button>`;
}

function syncRelatedControls(element, hasPhoto) {
    const employeeId = String(element.dataset.employeeId || '');
    const root = element.ownerDocument;
    [...root?.querySelectorAll?.('[data-employee-photo-editor-actions]') || []]
        .filter(group => group.dataset.employeeId === employeeId)
        .forEach(group => {
            const replace = group.querySelector('[data-employee-photo-action="change"]');
            const adjust = group.querySelector('[data-employee-photo-action="adjust"]');
            const remove = group.querySelector('[data-employee-photo-action="delete"]');
            if (replace) replace.textContent = hasPhoto ? 'Reemplazar' : 'Agregar foto';
            if (adjust) adjust.hidden = !hasPhoto;
            if (remove) remove.hidden = !hasPhoto;
        });
}

function resetToFallback(element) {
    const image = element.querySelector('[data-avatar-image]');
    const fallback = element.querySelector('[data-avatar-fallback]');
    if (image) {
        image.removeAttribute('src');
        image.hidden = true;
    }
    if (fallback) fallback.hidden = false;
    delete element.dataset.employeePhotoViewerTrigger;
    delete element.dataset.employeePhotoVersion;
    element.dataset.employeePhotoAcquisitionTrigger = '';
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', `Agregar foto de ${element.dataset.employeeName || 'Empleado'}`);
    syncRelatedControls(element, false);
}

function releaseAvatarUrl(element) {
    const active = activeAvatarUrls.get(element);
    if (active) {
        active.urlApi.revokeObjectURL(active.url);
        activeAvatarUrls.delete(element);
    }
    resetToFallback(element);
}

export function resetEmployeeAvatarToInitials(element) {
    releaseAvatarUrl(element);
}

function enablePhotoViewer(element, version) {
    delete element.dataset.employeePhotoAcquisitionTrigger;
    element.dataset.employeePhotoViewerTrigger = '';
    element.dataset.employeePhotoVersion = String(version);
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', `Ver foto de ${element.dataset.employeeName || 'Empleado'}`);
    syncRelatedControls(element, true);
}

function avatarElements(root) {
    if (!root) return [];
    const elements = root.matches?.('[data-employee-avatar]') ? [root] : [];
    return elements.concat([...root.querySelectorAll?.('[data-employee-avatar]') || []]);
}

export function cleanupEmployeeAvatars(root = document) {
    const scopedAvatars = new Set(avatarElements(root));
    for (const element of [...activeAvatarUrls.keys()]) {
        if (!element.isConnected || scopedAvatars.has(element)) {
            hydrationTokens.set(element, Symbol('avatar-cleanup'));
            releaseAvatarUrl(element);
        }
    }
}

function cleanupDetachedEmployeeAvatars() {
    for (const element of [...activeAvatarUrls.keys()]) {
        if (!element.isConnected) releaseAvatarUrl(element);
    }
}

async function hydrateAvatar(element, { photoStore, urlApi }) {
    const employeeId = String(element.dataset.employeeId || '').trim();
    if (!employeeId) return;
    const token = Symbol('avatar-hydration');
    hydrationTokens.set(element, token);

    let record = null;
    try {
        record = await photoStore.getEmployeePhoto(employeeId);
    } catch {
        record = null;
    }
    if (hydrationTokens.get(element) !== token || !element.isConnected) return;

    if (!(record?.thumbnailBlob instanceof Blob)) {
        releaseAvatarUrl(element);
        return;
    }

    const active = activeAvatarUrls.get(element);
    if (active && active.version === record.version) {
        element.querySelector('[data-avatar-image]').src = active.url;
        element.querySelector('[data-avatar-image]').hidden = false;
        element.querySelector('[data-avatar-fallback]').hidden = true;
        enablePhotoViewer(element, record.version);
        return;
    }

    const nextUrl = urlApi.createObjectURL(record.thumbnailBlob);
    if (hydrationTokens.get(element) !== token || !element.isConnected) {
        urlApi.revokeObjectURL(nextUrl);
        return;
    }

    const image = element.querySelector('[data-avatar-image]');
    const fallback = element.querySelector('[data-avatar-fallback]');
    image.src = nextUrl;
    image.hidden = false;
    fallback.hidden = true;
    enablePhotoViewer(element, record.version);
    activeAvatarUrls.set(element, { url: nextUrl, urlApi, version: record.version });
    if (active) active.urlApi.revokeObjectURL(active.url);
}

export async function hydrateEmployeeAvatars(
    root = document,
    { photoStore = employeePhotoService, urlApi = globalThis.URL } = {}
) {
    cleanupDetachedEmployeeAvatars();
    if (!urlApi?.createObjectURL || !urlApi?.revokeObjectURL) return;
    await Promise.all(avatarElements(root).map(element => hydrateAvatar(element, { photoStore, urlApi })));
}
