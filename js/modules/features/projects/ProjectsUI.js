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

function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
}

function modal() { return document.getElementById(MODAL_ID); }
function body() { return modal()?.querySelector('[data-project-setup-body]'); }

function notify(message, type = 'info') {
    window.showNotification?.(message, type);
}

function emitChanged(detail = {}) {
    window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail }));
}

function shell() {
    if (modal()) return;
    const el = document.createElement('div');
    el.id = MODAL_ID;
    el.style.cssText = 'position:fixed;inset:0;z-index:10060;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:16px;';
    el.innerHTML = `
        <section role="dialog" aria-modal="true" aria-labelledby="project-setup-title" style="width:min(620px,100%);max-height:92vh;overflow:auto;background:var(--card-bg,#fff);color:var(--text-color,#111827);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.3);">
            <header style="display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid rgba(148,163,184,.28);position:sticky;top:0;background:inherit;z-index:2">
                <div style="font-size:24px">🏗️</div>
                <div style="flex:1"><strong id="project-setup-title" style="font-size:18px">Proyecto de trabajo</strong><div style="font-size:12px;opacity:.68">Configuración oficial de Proyectos</div></div>
                <button type="button" data-project-setup-close aria-label="Cerrar" style="border:0;background:transparent;color:inherit;font-size:28px;cursor:pointer">×</button>
            </header>
            <div data-project-setup-body style="padding:18px 20px"></div>
        </section>`;
    el.querySelector('[data-project-setup-close]').addEventListener('click', closeProjectSetupModal);
    el.addEventListener('click', event => { if (event.target === el) closeProjectSetupModal(); });
    document.body.appendChild(el);
}

function primary(label, attrs = '') {
    return `<button type="button" ${attrs} style="width:100%;border:0;border-radius:12px;padding:12px 14px;font-weight:800;cursor:pointer;background:#2563eb;color:#fff">${label}</button>`;
}

async function renderState() {
    shell();
    const state = await projectSetupService.getState();
    if (!state.enabled) {
        body().innerHTML = `
            <div style="border:1px solid rgba(245,158,11,.38);background:rgba(245,158,11,.08);border-radius:14px;padding:14px;line-height:1.5">
                <strong>Proyectos está desactivado</strong>
                <p style="font-size:13px;margin:7px 0 0">Al activarlo, SA creará o recuperará el proyecto inicial oficial y asociará de forma aditiva los datos actuales a ese proyecto. La migración existente intenta crear un respaldo previo cuando hay sesión disponible y es reanudable/idempotente.</p>
            </div>
            <p style="font-size:12px;opacity:.7;line-height:1.5">No se creará un identificador a partir del nombre de la empresa y no se habilitará todavía la administración multiproyecto completa.</p>
            ${primary('Activar Proyectos y preparar el proyecto actual', 'data-project-activate')}
            <div data-project-setup-status style="font-size:12px;margin-top:10px"></div>`;
        body().querySelector('[data-project-activate]').addEventListener('click', activateProjects);
        return;
    }

    if (!state.ready || !state.activeProject) {
        body().innerHTML = `
            <div style="border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.07);border-radius:14px;padding:14px">
                <strong style="color:#dc2626">No se pudo resolver un proyecto activo</strong>
                <p style="font-size:13px;margin:7px 0 0">La aplicación permanecerá fail-closed para transferencias hasta recuperar un contexto válido.</p>
            </div>
            <div style="margin-top:14px">${primary('Reintentar inicialización', 'data-project-retry')}</div>
            <div data-project-setup-status style="font-size:12px;margin-top:10px"></div>`;
        body().querySelector('[data-project-retry]').addEventListener('click', activateProjects);
        return;
    }

    const project = state.activeProject;
    const projectCount = state.projects.length;
    body().innerHTML = `
        <div style="border:1px solid rgba(22,163,74,.35);background:rgba(22,163,74,.07);border-radius:14px;padding:14px">
            <div style="font-size:11px;opacity:.65;text-transform:uppercase;letter-spacing:.08em">Proyecto activo</div>
            <div style="font-size:20px;font-weight:800;margin-top:4px">${esc(project.name)}</div>
            <div style="font-size:11px;opacity:.62;margin-top:5px;font-family:monospace;word-break:break-all">${esc(project.id)}</div>
            ${state.defaultProjectId === project.id ? '<div style="font-size:11px;margin-top:7px;color:#15803d">Proyecto inicial / predeterminado</div>' : ''}
        </div>
        <label style="display:block;font-size:12px;font-weight:700;margin:16px 0 6px">Nombre del proyecto</label>
        <input data-project-name maxlength="80" value="${esc(project.name)}" style="width:100%;box-sizing:border-box;border:1px solid rgba(148,163,184,.55);border-radius:10px;padding:11px;background:var(--bg-primary,#fff);color:inherit">
        <div style="margin-top:10px">${primary('Guardar nombre', 'data-project-rename')}</div>
        <div data-project-setup-status style="font-size:12px;margin-top:10px"></div>
        <div data-project-list-section style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(148,163,184,.25)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;flex-wrap:wrap">
                <strong style="font-size:14px;display:flex;align-items:center;gap:6px">
                    <span>📂</span>
                    <span>Proyectos del sistema</span>
                </strong>
                <div style="display:flex;align-items:center;gap:8px">
                    <button type="button" data-project-create-open style="border:0;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;background:#2563eb;color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
                        <span>➕</span>
                        <span>Nuevo proyecto</span>
                    </button>
                    <span style="font-size:11px;opacity:.65;text-transform:uppercase;letter-spacing:.05em">Oficial</span>
                </div>
            </div>
            <div data-project-create-slot style="display:none;margin-bottom:14px"></div>
            <div data-project-list-container></div>
        </div>`;
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
                    if (status) status.innerHTML = `<strong style="color:#d97706">Atención:</strong> ${esc(msg)}`;
                    notify(msg, 'warning');
                    return;
                }
                if (button) {
                    button.disabled = true;
                    button.textContent = 'Cambiando…';
                }
                if (status) status.textContent = 'Cambiando de proyecto…';
                try {
                    const result = await projectSetupService.switchActiveProject(targetId);
                    if (result?.stale) return;
                    emitChanged({ projectId: result.activeProjectId, switched: true });
                    notify(`✅ Proyecto activo: ${result.activeProject?.name || result.activeProjectId}`, 'success');
                    window.render?.();
                    await renderState();
                } catch (error) {
                    if (status) status.innerHTML = `<strong style="color:#dc2626">Error:</strong> ${esc(error.message || error)}`;
                    notify('❌ ' + (error.message || error), 'error');
                } finally {
                    if (button) button.disabled = false;
                }
            }
        });
    }

    let isCreateOpen = false;
    const closeCreate = () => {
        isCreateOpen = false;
        if (createSlot) {
            createSlot.style.display = 'none';
            createSlot.innerHTML = '';
        }
    };

    const openCreate = () => {
        isCreateOpen = true;
        if (createSlot) {
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
        }
    };

    createBtn?.addEventListener('click', () => {
        if (isCreateOpen) closeCreate();
        else openCreate();
    });
}

async function activateProjects() {
    const status = body()?.querySelector('[data-project-setup-status]');
    const button = body()?.querySelector('[data-project-activate], [data-project-retry]');
    if (button) { button.disabled = true; button.textContent = 'Preparando proyecto…'; }
    if (status) status.textContent = 'Inicializando infraestructura y verificando el contexto…';
    try {
        const state = await projectSetupService.activate({ uid: window.currentUser?.uid || null });
        emitChanged({ projectId: state.activeProjectId, enabled: true });
        notify(`✅ Proyecto activo: ${state.activeProject?.name || state.activeProjectId}`, 'success');
        window.render?.();
        await renderState();
    } catch (error) {
        if (status) status.innerHTML = `<strong style="color:#dc2626">Error:</strong> ${esc(error.message || error)}`;
        if (button) { button.disabled = false; button.textContent = 'Reintentar'; }
    }
}

async function renameProject() {
    const input = body()?.querySelector('[data-project-name]');
    const status = body()?.querySelector('[data-project-setup-status]');
    try {
        const state = await projectSetupService.renameActiveProject(input?.value || '');
        emitChanged({ projectId: state.activeProjectId, renamed: true });
        notify(`✅ Proyecto actualizado: ${state.activeProject?.name}`, 'success');
        window.render?.();
        await renderState();
    } catch (error) {
        if (status) status.innerHTML = `<strong style="color:#dc2626">Error:</strong> ${esc(error.message || error)}`;
    }
}

export function closeProjectSetupModal() {
    modal()?.remove();
}

export async function openProjectSetupModal() {
    try {
        shell();
        await renderState();
    } catch (error) {
        notify('❌ ' + (error.message || error), 'error');
    }
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

export {
    openProjectListModal,
    closeProjectListModal,
    mountProjectList,
    renderProjectListHTML,
    openProjectCreateModal,
    closeProjectCreateModal,
    mountProjectCreateForm
};

export default {
    openProjectSetupModal,
    closeProjectSetupModal,
    openProjectListModal,
    closeProjectListModal,
    mountProjectList,
    renderProjectListHTML,
    openProjectCreateModal,
    closeProjectCreateModal,
    mountProjectCreateForm,
    switchActiveProject,
    registerProjectSetupGlobals
};
