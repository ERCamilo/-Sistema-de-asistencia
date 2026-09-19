import { projectSetupService } from './ProjectSetupService.js';
import { mountProjectOnboarding } from './ProjectOnboarding.js';

const CREATE_MODAL_ID = 'project-create-modal';
const ICONS = Object.freeze({
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
});

function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
}

export function renderProjectCreateFormHTML() {
    return `
        <div class="project-create-form" data-project-create-form>
            <div class="project-create-head">
                <div class="project-create-title">${ICONS.plus}<span>Crear proyecto vacío</span></div>
                <button type="button" class="project-icon-btn" data-project-create-cancel aria-label="Cancelar">${ICONS.close}</button>
            </div>
            <p class="project-create-copy">Asistente mínimo: el nuevo proyecto comenzará con asistencia, nómina y caja vacías.</p>
            <form data-project-create-element onsubmit="return false;">
                <div class="project-field" style="margin-top:0">
                    <label for="project-create-name-input">Nombre del proyecto</label>
                    <input id="project-create-name-input" type="text" data-project-create-name maxlength="80" placeholder="Ej. Torre Mirador, Obra Las Acacias" autocomplete="off">
                    <div class="project-create-meta"><span>Máximo 80 caracteres</span><span data-project-create-char-count>0/80</span></div>
                </div>
                <div class="project-status-line" data-project-create-status aria-live="polite"></div>
                <div class="project-actions" style="justify-content:flex-end">
                    <button type="button" class="project-action is-secondary" data-project-create-cancel-btn>Cancelar</button>
                    <button type="submit" class="project-action is-primary" data-project-create-submit>Crear proyecto vacío</button>
                </div>
            </form>
        </div>`;
}

export function mountProjectCreateForm(container, {
    setupService = projectSetupService,
    onSuccess = null,
    onCancel = null
} = {}) {
    if (!container) return null;
    container.innerHTML = renderProjectCreateFormHTML();

    const form = container.querySelector('[data-project-create-element]');
    const nameInput = container.querySelector('[data-project-create-name]');
    const charCount = container.querySelector('[data-project-create-char-count]');
    const statusEl = container.querySelector('[data-project-create-status]');
    const submitBtn = container.querySelector('[data-project-create-submit]');
    const cancelIconBtn = container.querySelector('[data-project-create-cancel]');
    const cancelTextBtn = container.querySelector('[data-project-create-cancel-btn]');
    let isSubmitting = false;

    function updateCharCount() {
        const len = nameInput ? nameInput.value.length : 0;
        if (charCount) charCount.textContent = `${len}/80`;
    }
    function setStatus(html, isError = false) {
        if (!statusEl) return;
        statusEl.innerHTML = html;
        statusEl.className = `project-status-line ${isError ? 'is-error' : 'is-success'}`;
    }
    function clearStatus() {
        if (!statusEl) return;
        statusEl.innerHTML = '';
        statusEl.className = 'project-status-line';
    }
    function handleCancel() {
        if (isSubmitting) return;
        clearStatus();
        onCancel?.();
    }

    async function handleSubmit(event) {
        if (event) event.preventDefault();
        if (isSubmitting) return;
        const rawValue = nameInput?.value ?? '';
        clearStatus();
        isSubmitting = true;
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creando proyecto…'; }
        if (cancelIconBtn) cancelIconBtn.disabled = true;
        if (cancelTextBtn) cancelTextBtn.disabled = true;

        try {
            const result = await setupService.createEmptyProject({ name: rawValue });
            if (nameInput) nameInput.value = '';
            updateCharCount();
            window.showNotification?.(`Proyecto creado: ${result.project?.name || ''}`, 'success');
            window.dispatchEvent(new CustomEvent('projects:created', { detail: { project: result.project } }));
            onSuccess?.(result.project, result.state);
        } catch (error) {
            setStatus(`<strong>Error:</strong> ${esc(error?.message || error)}`, true);
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Crear proyecto vacío'; }
            if (cancelIconBtn) cancelIconBtn.disabled = false;
            if (cancelTextBtn) cancelTextBtn.disabled = false;
            nameInput?.focus();
        } finally {
            isSubmitting = false;
        }
    }

    nameInput?.addEventListener('input', () => { updateCharCount(); clearStatus(); });
    cancelIconBtn?.addEventListener('click', handleCancel);
    cancelTextBtn?.addEventListener('click', handleCancel);
    form?.addEventListener('submit', handleSubmit);

    return {
        focus: () => nameInput?.focus(),
        reset: () => {
            if (nameInput) nameInput.value = '';
            updateCharCount();
            clearStatus();
        },
        unmount: () => { container.innerHTML = ''; }
    };
}

export function closeProjectCreateModal() { document.getElementById(CREATE_MODAL_ID)?.remove(); }

export async function openProjectCreateModal({ setupService = projectSetupService, onSuccess = null, onCancel = null } = {}) {
    closeProjectCreateModal();
    const state = await setupService.getState();
    if (!state.enabled) {
        window.showNotification?.('Proyectos no está activado.', 'error');
        return null;
    }

    const modalEl = document.createElement('div');
    modalEl.id = CREATE_MODAL_ID;
    modalEl.className = 'project-shell-overlay';
    modalEl.style.zIndex = '10070';
    modalEl.innerHTML = `
        <section class="project-shell is-compact" role="dialog" aria-modal="true" aria-labelledby="project-create-title">
            <header class="project-shell-header">
                <div class="project-shell-identity">${ICONS.plus}</div>
                <div class="project-shell-heading">
                    <h2 id="project-create-title" class="project-shell-title">Nuevo proyecto</h2>
                    <div class="project-shell-subtitle">Crea una obra vacía sin mezclar datos del proyecto actual.</div>
                </div>
                <button type="button" class="project-icon-btn" data-project-create-modal-close aria-label="Cerrar">${ICONS.close}</button>
            </header>
            <div class="project-shell-body" data-project-create-modal-slot></div>
        </section>`;

    const handleClose = () => { closeProjectCreateModal(); onCancel?.(); };
    modalEl.querySelector('[data-project-create-modal-close]').addEventListener('click', handleClose);
    modalEl.addEventListener('click', event => { if (event.target === modalEl) handleClose(); });
    document.body.appendChild(modalEl);

    const slot = modalEl.querySelector('[data-project-create-modal-slot]');
    const formHandle = mountProjectOnboarding(slot, {
        setupService,
        onSuccess: (project, nextState) => { closeProjectCreateModal(); onSuccess?.(project, nextState); },
        onCancel: handleClose
    });
    formHandle?.focus();
    return modalEl;
}

export default { renderProjectCreateFormHTML, mountProjectCreateForm, openProjectCreateModal, closeProjectCreateModal };
