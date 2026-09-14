import { projectSetupService } from './ProjectSetupService.js';
import {
    mountProjectList,
    openProjectListModal,
    closeProjectListModal,
    renderProjectListHTML
} from './ProjectListUI.js';
import {
    mountProjectCreateForm,
    openProjectCreateModal,
    closeProjectCreateModal
} from './ProjectCreateUI.js';
import { isSettingsDraftDirty } from '../../ui/settings/SettingsDraftBar.js';

const MODAL_ID = 'project-setup-modal';
const ICONS = Object.freeze({
    project: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V7l8-4 8 4v13"/><path d="M8 20v-5h8v5M8 9h.01M12 9h.01M16 9h.01"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
});

function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
}

function modal() { return document.getElementById(MODAL_ID); }
function body() { return modal()?.querySelector('[data-project-setup-body]'); }
function notify(message, type = 'info') { window.showNotification?.(message, type); }
function emitChanged(detail = {}) { window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail })); }

function shell() {
    if (modal()) return;
    const el = document.createElement('div');
    el.id = MODAL_ID;
    el.className = 'project-shell-overlay';
    el.innerHTML = `
        <section class="project-shell" role="dialog" aria-modal="true" aria-labelledby="project-setup-title">
            <header class="project-shell-header">
                <div class="project-shell-identity">${ICONS.project}</div>
                <div class="project-shell-heading">
                    <h2 id="project-setup-title" class="project-shell-title">Configuración de proyectos</h2>
                    <div class="project-shell-subtitle">Administra el proyecto de trabajo activo y tus demás obras.</div>
                </div>
                <button type="button" class="project-icon-btn" data-project-setup-close aria-label="Cerrar">${ICONS.close}</button>
            </header>
            <div class="project-shell-body" data-project-setup-body></div>
        </section>`;
    el.querySelector('[data-project-setup-close]').addEventListener('click', closeProjectSetupModal);
    el.addEventListener('click', event => { if (event.target === el) closeProjectSetupModal(); });
    document.body.appendChild(el);
}

function primary(label, attrs = '') {
    return `<button type="button" class="project-action is-primary" ${attrs}>${label}</button>`;
}

async function renderState() {
    shell();
    const state = await projectSetupService.getState();
    if (!state.enabled) {
        body().innerHTML = `
            <div class="project-notice is-warning">
                <strong>Proyectos está desactivado</strong>
                <p>Al activarlo, SA creará o recuperará el proyecto inicial y asociará de forma aditiva los datos actuales a ese proyecto. La migración intenta crear un respaldo previo cuando hay sesión disponible y puede reanudarse sin duplicar el proceso.</p>
            </div>
            <p class="project-help">No se creará un identificador a partir del nombre de la empresa. Después podrás crear otras obras y cambiar entre ellas.</p>
            <div class="project-actions is-stacked" style="margin-top:14px">${primary('Activar Proyectos y preparar el proyecto actual', 'data-project-activate')}</div>
            <div class="project-status-line" data-project-setup-status aria-live="polite"></div>`;
        body().querySelector('[data-project-activate]').addEventListener('click', activateProjects);
        return;
    }

    if (!state.ready || !state.activeProject) {
        body().innerHTML = `
            <div class="project-notice is-danger">
                <strong>No se pudo resolver un proyecto activo</strong>
                <p>La aplicación permanecerá bloqueada para transferencias hasta recuperar un contexto de proyecto válido.</p>
            </div>
            <div class="project-actions is-stacked" style="margin-top:14px">${primary('Reintentar inicialización', 'data-project-retry')}</div>
            <div class="project-status-line" data-project-setup-status aria-live="polite"></div>`;
        body().querySelector('[data-project-retry]').addEventListener('click', activateProjects);
        return;
    }

    const project = state.activeProject;
    body().innerHTML = `
        <div class="project-active-card">
            <div class="project-kicker">Proyecto activo</div>
            <div class="project-active-name">${esc(project.name)}</div>
            ${state.defaultProjectId === project.id ? '<div class="project-meta">Proyecto inicial / predeterminado</div>' : ''}
            <details class="project-tech-details"><summary>Detalles técnicos</summary><code>${esc(project.id)}</code></details>
        </div>
        <div class="project-field">
            <label for="project-active-name-input">Nombre del proyecto</label>
            <input id="project-active-name-input" data-project-name maxlength="80" value="${esc(project.name)}" autocomplete="off">
        </div>
        <div class="project-actions is-stacked" style="margin-top:10px">${primary('Guardar nombre', 'data-project-rename')}</div>
        <div class="project-status-line" data-project-setup-status aria-live="polite"></div>
        <section class="project-section" data-project-list-section>
            <div class="project-section-head">
                <h3 class="project-section-title">Tus proyectos</h3>
                <button type="button" class="project-action is-secondary" data-project-create-open>${ICONS.plus}<span>Nuevo proyecto</span></button>
            </div>
            <div data-project-create-slot style="display:none;margin-bottom:14px"></div>
            <div data-project-list-container></div>
        </section>`;
    body().querySelector('[data-project-rename]').addEventListener('click', renameProject);
    const listContainer = body()?.querySelector('[data-project-list-container]');
    const createSlot = body()?.querySelector('[data-project-create-slot]');
    const createBtn = body()?.querySelector('[data-project-create-open]');

    let listHandle = null;
    if (listContainer) {
        listHandle = mountProjectList(listContainer, {
            projects: state.projects,
            activeProjectId: state.activeProjectId,
            defaultProjectId: state.defaultProjectId,
            allowSwitch: true,
            setupService: projectSetupService,
            onSwitchProject: async (targetId, button) => {
                const status = body()?.querySelector('[data-project-setup-status]');
                if (typeof isSettingsDraftDirty === 'function' && isSettingsDraftDirty()) {
                    const msg = 'Hay cambios sin guardar en la configuración. Guarda o cancela los cambios manualmente antes de cambiar de proyecto.';
                    if (status) { status.textContent = msg; status.className = 'project-status-line is-error'; }
                    notify(msg, 'warning');
                    return;
                }
                if (button) { button.disabled = true; button.textContent = 'Cambiando…'; }
                if (status) { status.textContent = 'Cambiando de proyecto…'; status.className = 'project-status-line'; }
                try {
                    const result = await projectSetupService.switchActiveProject(targetId);
                    if (result?.stale) return;
                    emitChanged({ projectId: result.activeProjectId, switched: true });
                    notify(`Proyecto activo: ${result.activeProject?.name || result.activeProjectId}`, 'success');
                    window.render?.();
                    await renderState();
                } catch (error) {
                    if (status) { status.textContent = `Error: ${error.message || error}`; status.className = 'project-status-line is-error'; }
                    notify(String(error.message || error), 'error');
                } finally {
                    if (button) button.disabled = false;
                }
            }
        });
    }

    let isCreateOpen = false;
    const closeCreate = () => {
        isCreateOpen = false;
        if (createSlot) { createSlot.style.display = 'none'; createSlot.innerHTML = ''; }
    };
    const openCreate = () => {
        isCreateOpen = true;
        if (!createSlot) return;
        createSlot.style.display = 'block';
        mountProjectCreateForm(createSlot, {
            setupService: projectSetupService,
            onSuccess: async (createdProject, nextState) => {
                closeCreate();
                const freshState = nextState || await projectSetupService.getState();
                listHandle?.update({
                    projects: freshState.projects,
                    activeProjectId: freshState.activeProjectId,
                    defaultProjectId: freshState.defaultProjectId
                });
                emitChanged({ projectId: freshState.activeProjectId, createdProject: createdProject.id });
            },
            onCancel: closeCreate
        });
    };
    createBtn?.addEventListener('click', () => { if (isCreateOpen) closeCreate(); else openCreate(); });
}

async function activateProjects() {
    const status = body()?.querySelector('[data-project-setup-status]');
    const button = body()?.querySelector('[data-project-activate], [data-project-retry]');
    if (button) { button.disabled = true; button.textContent = 'Preparando proyecto…'; }
    if (status) { status.textContent = 'Inicializando infraestructura y verificando el contexto…'; status.className = 'project-status-line'; }
    try {
        const state = await projectSetupService.activate({ uid: window.currentUser?.uid || null });
        emitChanged({ projectId: state.activeProjectId, enabled: true });
        notify(`Proyecto activo: ${state.activeProject?.name || state.activeProjectId}`, 'success');
        window.render?.();
        await renderState();
    } catch (error) {
        if (status) { status.textContent = `Error: ${error.message || error}`; status.className = 'project-status-line is-error'; }
        if (button) { button.disabled = false; button.textContent = 'Reintentar'; }
    }
}

async function renameProject() {
    const input = body()?.querySelector('[data-project-name]');
    const status = body()?.querySelector('[data-project-setup-status]');
    try {
        const state = await projectSetupService.renameActiveProject(input?.value || '');
        emitChanged({ projectId: state.activeProjectId, renamed: true });
        notify(`Proyecto actualizado: ${state.activeProject?.name}`, 'success');
        window.render?.();
        await renderState();
    } catch (error) {
        if (status) { status.textContent = `Error: ${error.message || error}`; status.className = 'project-status-line is-error'; }
    }
}

export function closeProjectSetupModal() { modal()?.remove(); }
export async function openProjectSetupModal() {
    try { shell(); await renderState(); }
    catch (error) { notify(String(error.message || error), 'error'); }
}

export function registerProjectSetupGlobals() {
    window.getProjectSetupState = () => projectSetupService.getState();
    window.openProjectSetupModal = openProjectSetupModal;
    window.closeProjectSetupModal = closeProjectSetupModal;
    window.openProjectListModal = openProjectListModal;
    window.closeProjectListModal = closeProjectListModal;
    window.mountProjectList = mountProjectList;
    window.renderProjectList = mountProjectList;
    window.openProjectCreateModal = openProjectCreateModal;
    window.closeProjectCreateModal = closeProjectCreateModal;
    window.mountProjectCreateForm = mountProjectCreateForm;
    window.switchActiveProject = (id) => projectSetupService.switchActiveProject(id);
}

export const switchActiveProject = (id) => projectSetupService.switchActiveProject(id);
export { openProjectListModal, closeProjectListModal, mountProjectList, renderProjectListHTML, openProjectCreateModal, closeProjectCreateModal, mountProjectCreateForm };
export default { openProjectSetupModal, closeProjectSetupModal, openProjectListModal, closeProjectListModal, mountProjectList, renderProjectListHTML, openProjectCreateModal, closeProjectCreateModal, mountProjectCreateForm, switchActiveProject, registerProjectSetupGlobals };
