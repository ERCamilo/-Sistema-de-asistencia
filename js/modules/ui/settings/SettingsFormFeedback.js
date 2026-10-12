import { eventBus } from '../../core/Events.js';

// Transient validation feedback; never persisted or synchronized.
const errors = new Map();
let formError = null;
const scope = doc => doc.getElementById('settings-screen')?.dataset.settingsDraftScope ?? null;
const value = el => el?.type === 'checkbox' ? el.checked : el?.value;

function removeMessage(id, doc) {
    doc.getElementById(`settings-error-${id}`)?.remove();
    const field = doc.getElementById(id);
    if (!field) return;
    const described = (field.getAttribute('aria-describedby') || '').split(/\s+/)
        .filter(token => token && token !== `settings-error-${id}`);
    if (described.length) field.setAttribute('aria-describedby', described.join(' '));
    else field.removeAttribute('aria-describedby');
    field.removeAttribute('aria-invalid');
}

export function clearSettingsFieldError(id, doc = document) {
    errors.delete(id);
    removeMessage(id, doc);
}

export function clearSettingsFormErrors(doc = document) {
    for (const id of errors.keys()) removeMessage(id, doc);
    errors.clear();
    formError = null;
    doc.getElementById('settings-form-error')?.remove();
}

export function refreshSettingsFormErrors(doc = document) {
    for (const [id, error] of errors) {
        const field = doc.getElementById(id);
        if (scope(doc) !== error.scope || (field && value(field) !== error.value)) {
            clearSettingsFieldError(id, doc);
            continue;
        }
        if (!field) continue;
        let message = doc.getElementById(`settings-error-${id}`);
        if (!message) {
            message = doc.createElement('p');
            message.id = `settings-error-${id}`;
            message.className = 'settings-field-error';
            message.setAttribute('role', 'alert');
            (field.closest('.form-group') || field.parentElement).append(message);
        }
        message.textContent = error.message;
        field.setAttribute('aria-invalid', 'true');
        const described = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        described.add(message.id);
        field.setAttribute('aria-describedby', [...described].join(' '));
    }
    if (formError && formError.scope !== scope(doc)) formError = null;
    if (formError) {
        let message = doc.getElementById('settings-form-error');
        if (!message) {
            message = doc.createElement('p');
            message.id = 'settings-form-error';
            message.className = 'settings-field-error';
            message.setAttribute('role', 'alert');
            const host = doc.getElementById('settings-screen');
            if (host) host.prepend(message);
            else doc.body.prepend(message);
        }
        message.textContent = formError.message;
    }
}

export function showSettingsFieldError(id, message, doc = document) {
    const field = doc.getElementById(id);
    if (!field) return showSettingsFormError(message, doc);
    errors.set(id, { message, value: value(field), scope: scope(doc) });
    refreshSettingsFormErrors(doc);
    field.focus();
    field.scrollIntoView?.({ block: 'center', behavior: 'auto' });
}

export function showSettingsFormError(message, doc = document, expectedScope = scope(doc)) {
    if (expectedScope !== scope(doc)) return;
    formError = { message, scope: scope(doc) };
    refreshSettingsFormErrors(doc);
    doc.getElementById('settings-form-error')?.scrollIntoView?.({ block: 'center' });
}

// Input corrections clear only their own error; unrelated errors stay visible.
for (const event of ['input', 'change']) document.addEventListener(event, ({ target }) => {
    if (target?.id && errors.has(target.id)) clearSettingsFieldError(target.id);
});
eventBus.on('render:complete', () => refreshSettingsFormErrors());
