import { projectSetupService } from './ProjectSetupService.js';

const CREATE_MODAL_ID = 'project-create-modal';

function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
}

export function renderProjectCreateFormHTML() {
    return `
        <div class="project-create-form" data-project-create-form style="border:1px solid rgba(37,99,235,.28);border-radius:14px;background:rgba(37,99,235,.04);padding:16px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:18px">✨</span>
                    <strong style="font-size:14px;color:var(--text-color,#111827)">Crear proyecto vacío</strong>
                </div>
                <button type="button" data-project-create-cancel aria-label="Cancelar" style="border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer;opacity:.65">✕</button>
            </div>
            <p style="font-size:12px;opacity:.75;margin:0 0 12px;line-height:1.4">
                Asistente mínimo: el nuevo proyecto comenzará con asistencia, nómina y caja vacías.
            </p>
            <form data-project-create-element style="display:flex;flex-direction:column;gap:10px" onsubmit="return false;">
                <div>
                    <label for="project-create-name-input" style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">
                        Nombre del proyecto
                    </label>
                    <input
                        id="project-create-name-input"
                        type="text"
                        data-project-create-name
                        maxlength="80"
                        placeholder="Ej. Torre Mirador, Obra Las Acacias"
                        autocomplete="off"
                        style="width:100%;box-sizing:border-box;border:1px solid rgba(148,163,184,.55);border-radius:10px;padding:10px 12px;font-size:13px;background:var(--bg-primary,#fff);color:inherit"
                    />
                    <div style="display:flex;justify-content:space-between;font-size:11px;opacity:.6;margin-top:4px">
                        <span>Máximo 80 caracteres</span>
                        <span data-project-create-char-count>0/80</span>
                    </div>
                </div>
                <div data-project-create-status style="font-size:12px;min-height:18px;line-height:1.4"></div>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button
                        type="button"
                        data-project-create-cancel-btn
                        style="border:1px solid rgba(148,163,184,.4);border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;background:transparent;color:inherit;cursor:pointer">
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        data-project-create-submit
                        style="border:0;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;background:#2563eb;color:#fff;cursor:pointer">
                        Crear proyecto vacío
                    </button>
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
        statusEl.style.color = isError ? '#dc2626' : '#15803d';
    }

    function clearStatus() {
        if (!statusEl) return;
        statusEl.innerHTML = '';
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
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creando proyecto…';
        }
        if (cancelIconBtn) cancelIconBtn.disabled = true;
        if (cancelTextBtn) cancelTextBtn.disabled = true;

        try {
            const result = await setupService.createEmptyProject({ name: rawValue });
            if (nameInput) nameInput.value = '';
            updateCharCount();

            window.showNotification?.(`✅ Proyecto creado: ${result.project?.name || ''}`, 'success');
            window.dispatchEvent(new CustomEvent('projects:created', { detail: { project: result.project } }));

            onSuccess?.(result.project, result.state);
        } catch (error) {
            setStatus(`<strong style="color:#dc2626">Error:</strong> ${esc(error?.message || error)}`, true);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Crear proyecto vacío';
            }
            if (cancelIconBtn) cancelIconBtn.disabled = false;
            if (cancelTextBtn) cancelTextBtn.disabled = false;
            nameInput?.focus();
        } finally {
            isSubmitting = false;
        }
    }

    nameInput?.addEventListener('input', () => {
        updateCharCount();
        clearStatus();
    });

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
        unmount: () => {
            container.innerHTML = '';
        }
    };
}

export function closeProjectCreateModal() {
    document.getElementById(CREATE_MODAL_ID)?.remove();
}

export async function openProjectCreateModal({
    setupService = projectSetupService,
    onSuccess = null,
    onCancel = null
} = {}) {
    closeProjectCreateModal();

    const state = await setupService.getState();
    if (!state.enabled) {
        window.showNotification?.('Proyectos no está activado.', 'error');
        return null;
    }

    const modalEl = document.createElement('div');
    modalEl.id = CREATE_MODAL_ID;
    modalEl.style.cssText = 'position:fixed;inset:0;z-index:10070;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:16px;';
    modalEl.innerHTML = `
        <section role="dialog" aria-modal="true" aria-labelledby="project-create-title" style="width:min(520px,100%);background:var(--card-bg,#fff);color:var(--text-color,#111827);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.3);padding:20px">
            <header style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
                <strong id="project-create-title" style="font-size:16px;display:flex;align-items:center;gap:6px">
                    <span>✨</span>
                    <span>Nuevo proyecto</span>
                </strong>
                <button type="button" data-project-create-modal-close aria-label="Cerrar" style="border:0;background:transparent;color:inherit;font-size:24px;cursor:pointer">×</button>
            </header>
            <div data-project-create-modal-slot></div>
        </section>`;

    const handleClose = () => {
        closeProjectCreateModal();
        onCancel?.();
    };

    modalEl.querySelector('[data-project-create-modal-close]').addEventListener('click', handleClose);
    modalEl.addEventListener('click', event => { if (event.target === modalEl) handleClose(); });
    document.body.appendChild(modalEl);

    const slot = modalEl.querySelector('[data-project-create-modal-slot]');
    const formHandle = mountProjectCreateForm(slot, {
        setupService,
        onSuccess: (project, nextState) => {
            closeProjectCreateModal();
            onSuccess?.(project, nextState);
        },
        onCancel: handleClose
    });

    formHandle?.focus();
    return modalEl;
}

export default {
    renderProjectCreateFormHTML,
    mountProjectCreateForm,
    openProjectCreateModal,
    closeProjectCreateModal
};
