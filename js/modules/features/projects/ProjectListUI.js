import { PROJECT_STATUS } from './Project.js';
import { projectDeletionPolicy } from './ProjectDeletionPolicy.js';
import { projectSetupService } from './ProjectSetupService.js';
import { mountProjectCreateForm, openProjectCreateModal, closeProjectCreateModal } from './ProjectCreateUI.js';
import { attachProjectDialogA11y } from './ProjectDialogA11y.js';
import { mountProjectOnboarding } from './ProjectOnboarding.js';
import { isSettingsDraftDirty } from '../../ui/settings/SettingsDraftBar.js';
import { openProjectNameConflicts } from './ProjectNameConflictUI.js';

export const PROJECT_FILTERS = Object.freeze({ ALL: 'all', ACTIVE: PROJECT_STATUS.ACTIVE, CLOSED: PROJECT_STATUS.CLOSED, ARCHIVED: PROJECT_STATUS.ARCHIVED });
const STATUS_ICONS = Object.freeze({
    active: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    closed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    archived: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6"/></svg>'
});
const ICONS = Object.freeze({
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    current: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11 12 4l8 7v9H4zM9 20v-6h6v6"/></svg>',
    switch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>'
});

export const PROJECT_STATUS_META = Object.freeze({
    [PROJECT_STATUS.ACTIVE]: Object.freeze({ label: 'Activo', badgeClass: 'badge-status-active', icon: STATUS_ICONS.active, description: 'Proyecto en curso' }),
    [PROJECT_STATUS.CLOSED]: Object.freeze({ label: 'Cerrado', badgeClass: 'badge-status-closed', icon: STATUS_ICONS.closed, description: 'Cerrado para operaciones' }),
    [PROJECT_STATUS.ARCHIVED]: Object.freeze({ label: 'Archivado', badgeClass: 'badge-status-archived', icon: STATUS_ICONS.archived, description: 'Archivado visualmente' })
});

const MODAL_ID = 'project-list-modal';
let detachProjectListA11y = null;
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch])); }

export function formatProjectDate(timestamp) {
    if (!timestamp || !Number.isFinite(Number(timestamp))) return '—';
    const d = new Date(Number(timestamp));
    if (isNaN(d.getTime())) return '—';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function calculateProjectStats(projects = []) {
    const list = Array.isArray(projects) ? projects : [];
    const out = { total: list.length, active: 0, closed: 0, archived: 0 };
    for (const p of list) {
        if (p?.status === PROJECT_STATUS.ACTIVE) out.active++;
        else if (p?.status === PROJECT_STATUS.CLOSED) out.closed++;
        else if (p?.status === PROJECT_STATUS.ARCHIVED) out.archived++;
    }
    return out;
}
export function filterProjects(projects = [], filter = PROJECT_FILTERS.ALL) {
    const list = Array.isArray(projects) ? projects : [];
    return !filter || filter === PROJECT_FILTERS.ALL ? [...list] : list.filter(p => p?.status === filter);
}
export function groupProjectsByStatus(projects = []) {
    const grouped = { [PROJECT_STATUS.ACTIVE]: [], [PROJECT_STATUS.CLOSED]: [], [PROJECT_STATUS.ARCHIVED]: [] };
    for (const p of (Array.isArray(projects) ? projects : [])) (grouped[p?.status] || grouped[PROJECT_STATUS.ACTIVE]).push(p);
    return grouped;
}

export function renderProjectUsageHTML(usage) {
    if (!usage?.verified) return '<div class="project-help" data-project-usage-unknown>Datos sin verificar</div>';
    const labels = { employees: ['Empleado', 'Empleados'], positions: ['Posición', 'Posiciones'], loans: ['Préstamo', 'Préstamos'], attendance: ['Asistencia', 'Asistencias'], leaders: ['Líder', 'Líderes'], payrollClosures: ['Cierre', 'Cierres'], pettyCash: ['Registro de caja', 'Registros de caja'], other: ['Otra referencia', 'Otras referencias'], pending: ['Pendiente de sincronizar', 'Pendientes de sincronizar'] };
    return `<div class="project-usage" data-project-usage><span class="project-badge ${usage.empty ? 'badge-status-active' : ''}" data-project-empty="${usage.empty}">${usage.empty ? 'Vacía' : 'Con datos'}</span>${Object.entries(labels).filter(([key]) => ['employees', 'positions', 'loans'].includes(key) || usage[key] > 0).map(([key, label]) => `<span class="project-usage-item"><strong>${usage[key]}</strong> ${label[usage[key] === 1 ? 0 : 1]}</span>`).join('')}</div>`;
}

export function renderProjectItemHTML(project, { activeProjectId = null, defaultProjectId = null, allowSwitch = false, usage = {}, confirmDeleteId = null, confirmRequestId = null, deletingId = null, now = Date.now() } = {}) {
    if (!project) return '';
    const statusMeta = PROJECT_STATUS_META[project.status] || PROJECT_STATUS_META[PROJECT_STATUS.ACTIVE];
    const isActiveContext = !!(activeProjectId && String(project.id) === String(activeProjectId));
    const isDefault = !!(defaultProjectId && String(project.id) === String(defaultProjectId));
    const statusOperations = {
        [PROJECT_STATUS.ACTIVE]: ['close', 'Pausar obra'],
        [PROJECT_STATUS.CLOSED]: ['archive', 'Archivar obra'],
        [PROJECT_STATUS.ARCHIVED]: ['unarchive', 'Sacar del archivo']
    };
    const operation = statusOperations[project.status];
    const unavailable = isDefault || isActiveContext || !!deletingId || project.deletionRequestedAt != null;
    const statusAction = allowSwitch && operation
        ? '<div class="project-status-actions"><button type="button" class="project-action is-secondary"'
            + ' data-project-status-action="' + operation[0] + '" data-project-status-id="' + esc(project.id) + '"'
            + (unavailable ? ' disabled' : '') + '>' + esc(operation[1]) + '</button>'
            + (project.status === PROJECT_STATUS.CLOSED
                ? '<button type="button" class="project-action is-secondary" data-project-status-action="reopen"'
                    + ' data-project-status-id="' + esc(project.id) + '"' + (unavailable ? ' disabled' : '')
                    + '>Reabrir obra</button>' : '')
            + (unavailable ? '<small class="project-help">'
                + (project.deletionRequestedAt != null ? 'Cancela primero la solicitud de eliminación.'
                    : isDefault ? 'La obra inicial debe permanecer activa.' : 'Cambia primero a otra obra activa.')
                + '</small>' : '') + '</div>'
        : '';
    const deletion = projectDeletionPolicy(project, now);
    const protectedProject = isDefault || isActiveContext;
    let deletionActions = '';
    if (allowSwitch && ['closed', 'archived'].includes(project.status)) {
        let message = '';
        if (protectedProject) message = 'La obra inicial o en uso no se puede eliminar.';
        else if (deletion.stage === 'paused-wait') {
            message = 'Pausada. Faltan ' + deletion.remainingDays
                + ' días para poder solicitar su eliminación (desde ' + formatProjectDate(deletion.eligibleAt) + ').';
        } else if (deletion.stage === 'eligible-to-request') {
            message = 'Cumplió 30 días pausada. Puedes solicitar su eliminación; después habrá otros 30 días para cancelarla.';
        } else if (deletion.stage === 'grace-period') {
            message = 'Eliminación solicitada. Restan ' + deletion.remainingDays + ' días de espera, hasta el '
                + formatProjectDate(deletion.finalizeAt) + '. Puedes cancelar la solicitud.';
        } else if (deletion.stage === 'ready-for-review') {
            message = 'Cumplió 30 días desde la solicitud. Falta la revisión final de seguridad.';
        } else if (deletion.stage === 'invalid') {
            message = 'La fecha de pausa o de solicitud necesita revisión. No se permite borrar.';
        }
        deletionActions = '<div class="project-delete-actions" data-project-deletion-policy="'
            + esc(deletion.stage) + '"><p class="project-help">' + esc(message) + '</p>';
        if (!protectedProject && deletion.canRequest) {
            deletionActions += '<button type="button" class="project-action is-secondary"'
                + ' data-project-request-delete="' + esc(project.id) + '">Solicitar eliminación</button>';
        }
        if (!protectedProject && deletion.canCancel) {
            deletionActions += '<button type="button" class="project-action is-secondary"'
                + ' data-project-cancel-request="' + esc(project.id) + '">Cancelar solicitud</button>';
        }
        if (!protectedProject && deletion.canFinalizeEmpty && usage[project.id]?.verified && usage[project.id].empty) {
            deletionActions += '<button type="button" class="project-action is-secondary is-delete-project"'
                + ' data-project-delete="' + esc(project.id) + '"'
                + (usage[project.id].deleteReason || deletingId ? ' disabled' : '')
                + '>Finalizar eliminación de obra vacía</button>';
        }
        if (deletion.stage === 'ready-for-review' && usage[project.id]?.verified
            && !usage[project.id].empty) {
            deletionActions += '<p class="project-help" role="status">'
                + 'La eliminación sigue bloqueada porque hay datos o relaciones. '
                + 'No existe borrado automático con historial.</p>';
        }
        if (confirmRequestId === project.id) {
            deletionActions += '<div class="project-notice is-warning">'
                + '<strong>¿Solicitar la eliminación de esta obra?</strong>'
                + '<p>No se borrará todavía. Tendrás al menos 30 días adicionales para cancelar. '
                + 'El borrado con historial seguirá bloqueado hasta verificar respaldo y sincronización.</p>'
                + '<button type="button" class="project-action is-secondary" data-project-request-cancel>Volver</button>'
                + '<button type="button" class="project-action is-danger" data-project-request-confirm="'
                + esc(project.id) + '">Confirmar solicitud</button></div>';
        }
        deletionActions += '</div>';
    }
    const switchAction = allowSwitch && project.status === PROJECT_STATUS.ACTIVE && !isActiveContext
        ? `<div style="margin-top:10px"><button type="button" class="project-action is-secondary btn-switch-project" data-project-switch="${esc(project.id)}" data-switch-project="${esc(project.id)}">${ICONS.switch}<span>Cambiar a este proyecto</span></button></div>` : '';
    return `
        <li class="project-item" data-project-id="${esc(project.id)}" data-project-status="${esc(project.status)}">
            <div class="project-item-main">
                <div class="project-item-copy">
                    <div class="project-badges">
                        <span class="project-badge ${statusMeta.badgeClass}" data-status-badge="${esc(project.status)}">${statusMeta.icon}<span>${esc(statusMeta.label)}</span></span>
                        ${isActiveContext ? `<span class="project-badge badge-active-context" data-active-context-badge="true">${ICONS.current}<span>En uso</span></span>` : ''}
                        ${isDefault ? `<span class="project-badge badge-default-project" data-default-project-badge="true">${ICONS.home}<span>Inicial</span></span>` : ''}
                    </div>
                    <div class="project-name" data-project-name-display>${esc(project.name || 'Sin nombre')}</div>
                    ${project.metadata?.nameConflict ? '<button type="button" class="project-action is-secondary" data-project-name-conflict>Resolver nombre repetido</button>' : ''}
                    <div class="project-id" data-project-id-display>${esc(project.id)}</div>
                    ${switchAction}
                    ${statusAction}
                    ${deletionActions}
                </div>
                <div class="project-item-dates">
                    <div>Creado: <strong>${formatProjectDate(project.createdAt)}</strong></div>
                    ${project.closedAt ? `<div>Cerrado: <strong>${formatProjectDate(project.closedAt)}</strong></div>` : ''}
                    ${project.archivedAt ? `<div>Archivado: <strong>${formatProjectDate(project.archivedAt)}</strong></div>` : ''}
                </div>
            </div>
            ${project.metadata?.deletionConflict ? '<div class="project-notice is-warning">Borrado remoto pendiente: esta obra conserva datos o está en uso aquí.</div>' : ''}
            ${renderProjectUsageHTML(usage[project.id])}
            ${usage[project.id]?.verified && !usage[project.id].empty
                ? '<div class="project-notice is-warning" data-project-delete-protected>'
                    + '<strong>Esta obra conserva historial y relaciones.</strong>'
                    + '<p>Antes de eliminarla hay que respaldar, identificar datos compartidos y coordinar el borrado en todos los dispositivos. '
                    + 'Por seguridad, el borrado definitivo con datos está deshabilitado. Puedes cerrar y archivar la obra sin perder su historial.</p>'
                    + '<button type="button" class="project-action is-secondary" data-project-impact="' + esc(project.id)
                    + '">Revisar impacto de eliminación</button></div>' : ''}
            ${usage[project.id]?.verified && usage[project.id].empty && deletion.canFinalizeEmpty
                && !protectedProject && usage[project.id].deleteReason
                ? '<p class="project-help">' + esc(usage[project.id].deleteReason) + '</p>' : ''}
            ${confirmDeleteId === project.id && usage[project.id]?.empty && deletion.canFinalizeEmpty ? `<div class="project-notice is-warning project-delete-confirm"><strong>¿Finalizar eliminación de «${esc(project.name)}»?</strong><p>Solo se retirará la obra vacía del catálogo, conservando una lápida sincronizable para impedir su reaparición.</p><div class="project-actions"><button type="button" class="project-action is-secondary" data-project-delete-cancel ${deletingId ? 'disabled' : ''}>Conservar</button><button type="button" class="project-action is-danger" data-project-delete-confirm="${esc(project.id)}" ${deletingId ? 'disabled' : ''}>${deletingId ? 'Comprobando…' : 'Confirmar borrado'}</button></div></div>` : ''}
            ${project.metadata?.notes ? `<div class="project-notes">${esc(project.metadata.notes)}</div>` : ''}
            ${project.metadata?.clonedFrom ? `<div class="project-meta">Basado en: <code>${esc(project.metadata.clonedFrom.sourceProjectId || 'otro proyecto')}</code></div>` : ''}
        </li>`;
}

function renderSectionGroup(title, status, items, options) {
    if (!items?.length) return '';
    const meta = PROJECT_STATUS_META[status] || PROJECT_STATUS_META[PROJECT_STATUS.ACTIVE];
    return `<section class="project-status-group"><div class="project-status-heading">${meta.icon}<span>${esc(title)} (${items.length})</span></div><ul class="project-list" role="list">${items.map(p => renderProjectItemHTML(p, options)).join('')}</ul></section>`;
}

export function renderProjectListHTML({ projects = [], activeProjectId = null, defaultProjectId = null, currentFilter = PROJECT_FILTERS.ALL, allowSwitch = false, usage = {}, confirmDeleteId = null, confirmRequestId = null, deletingId = null, now = Date.now() } = {}) {
    const list = Array.isArray(projects) ? projects : [];
    const stats = calculateProjectStats(list);
    const options = { activeProjectId, defaultProjectId, allowSwitch, usage, confirmDeleteId, confirmRequestId, deletingId, now };
    const tab = (key, text) => `<button type="button" class="project-filter-tab ${currentFilter === key ? 'is-active' : ''}" data-project-filter="${key}" role="tab" aria-selected="${currentFilter === key}">${text}</button>`;
    const tabs = `<div class="project-filter-tabs project-list-tabs" role="tablist" aria-label="Filtrar proyectos por estado">${tab(PROJECT_FILTERS.ALL, `Todos (${stats.total})`)}${tab(PROJECT_FILTERS.ACTIVE, `Activos (${stats.active})`)}${tab(PROJECT_FILTERS.CLOSED, `Cerrados (${stats.closed})`)}${tab(PROJECT_FILTERS.ARCHIVED, `Archivados (${stats.archived})`)}</div>`;
    if (!stats.total) return `${tabs}<div class="project-list-empty" data-empty-state="all">No hay proyectos registrados en el sistema.</div>`;

    let content = '';
    if (currentFilter === PROJECT_FILTERS.ALL) {
        const grouped = groupProjectsByStatus(list);
        content = `<div class="project-list-grouped" data-projects-list>${renderSectionGroup('Proyectos activos', PROJECT_STATUS.ACTIVE, grouped[PROJECT_STATUS.ACTIVE], options)}${renderSectionGroup('Proyectos cerrados', PROJECT_STATUS.CLOSED, grouped[PROJECT_STATUS.CLOSED], options)}${renderSectionGroup('Proyectos archivados', PROJECT_STATUS.ARCHIVED, grouped[PROJECT_STATUS.ARCHIVED], options)}</div>`;
    } else {
        const filtered = filterProjects(list, currentFilter);
        if (!filtered.length) {
            const label = currentFilter === PROJECT_FILTERS.ACTIVE ? 'activos' : currentFilter === PROJECT_FILTERS.CLOSED ? 'cerrados' : 'archivados';
            content = `<div class="project-list-empty" data-empty-state="${esc(currentFilter)}">No hay proyectos ${esc(label)}.</div>`;
        } else {
            content = `<ul class="project-list" role="list" data-projects-list>${filtered.map(p => renderProjectItemHTML(p, options)).join('')}</ul>`;
        }
    }
    return `<div class="project-list-container" data-project-list-view><p class="project-help" data-project-usage-scope>Registros en este dispositivo, incluido el historial.</p>${tabs}${content}</div>`;
}

export function mountProjectList(container, { projects = [], activeProjectId = null, defaultProjectId = null, initialFilter = PROJECT_FILTERS.ALL, onFilterChange = null, onSwitchProject = null, allowSwitch = false, setupService = projectSetupService } = {}) {
    if (!container) return null;
    let currentProjects = Array.isArray(projects) ? [...projects] : [];
    let currentActiveId = activeProjectId;
    let currentDefaultId = defaultProjectId;
    let currentFilter = initialFilter;
    let usage = {}, usageGeneration = 0, confirmDeleteId = null, confirmRequestId = null, deletingId = null, deleteError = '';
    let statusBusyId = null;
    const shouldAllowSwitch = allowSwitch || typeof onSwitchProject === 'function';

    function render() {
        container.innerHTML = renderProjectListHTML({ projects: currentProjects, activeProjectId: currentActiveId, defaultProjectId: currentDefaultId, currentFilter, allowSwitch: shouldAllowSwitch, usage, confirmDeleteId, confirmRequestId, deletingId });
        if (deleteError) container.insertAdjacentHTML('afterbegin', `<div class="project-status-line is-error" role="alert">${esc(deleteError)}</div>`);
        container.querySelectorAll('[data-project-request-delete]').forEach(button => button.addEventListener('click', () => {
            if (statusBusyId || deletingId || button.disabled) return;
            confirmRequestId = button.dataset.projectRequestDelete;
            deleteError = '';
            render();
            container.querySelector('[data-project-request-confirm]')?.focus();
        }));
        container.querySelector('[data-project-request-cancel]')?.addEventListener('click', () => {
            confirmRequestId = null;
            render();
        });
        container.querySelectorAll('[data-project-request-confirm]').forEach(button => button.addEventListener('click', async () => {
            if (statusBusyId || deletingId || !confirmRequestId) return;
            const id = confirmRequestId;
            confirmRequestId = null;
            statusBusyId = id;
            render();
            try {
                const result = await setupService.changeProjectDeletionRequest(id, { cancel: false });
                const fresh = result.state || await setupService.getState();
                currentProjects = fresh.projects;
                currentActiveId = fresh.activeProjectId;
                currentDefaultId = fresh.defaultProjectId;
                window.showNotification?.('Solicitud guardada. La obra permanecerá disponible para cancelar durante 30 días.', 'success');
            } catch (error) {
                deleteError = error?.message || 'No se pudo solicitar la eliminación.';
            } finally {
                statusBusyId = null;
                await refreshUsage();
                render();
            }
        }));
        container.querySelectorAll('[data-project-cancel-request]').forEach(button => button.addEventListener('click', async () => {
            if (statusBusyId || deletingId || button.disabled) return;
            const id = button.dataset.projectCancelRequest;
            statusBusyId = id;
            render();
            try {
                const result = await setupService.changeProjectDeletionRequest(id, { cancel: true });
                const fresh = result.state || await setupService.getState();
                currentProjects = fresh.projects;
                currentActiveId = fresh.activeProjectId;
                currentDefaultId = fresh.defaultProjectId;
                window.showNotification?.('Solicitud cancelada. La obra y sus datos se conservan.', 'success');
            } catch (error) {
                deleteError = error?.message || 'No se pudo cancelar la solicitud.';
            } finally {
                statusBusyId = null;
                await refreshUsage();
                render();
            }
        }));
        container.querySelectorAll('[data-project-delete]').forEach(button => button.addEventListener('click', () => {
            if (deletingId || button.disabled) return;
            confirmDeleteId = button.dataset.projectDelete;
            deleteError = '';
            render();
            container.querySelector('[data-project-delete-confirm]')?.focus();
        }));
        container.querySelector('[data-project-delete-cancel]')?.addEventListener('click', () => {
            confirmDeleteId = null;
            render();
        });
        container.querySelector('[data-project-delete-confirm]')?.addEventListener('click', async () => {
            if (deletingId) return;
            deletingId = confirmDeleteId;
            render();
            try {
                await setupService.deleteEmptyProject(deletingId);
                const fresh = await setupService.getState();
                currentProjects = fresh.projects;
                currentActiveId = fresh.activeProjectId;
                currentDefaultId = fresh.defaultProjectId;
                confirmDeleteId = null;
                window.showNotification?.('Obra vacía borrada.', 'success');
            } catch (error) { deleteError = error.message || String(error); }
            finally { deletingId = null; await refreshUsage(); render(); }
        });
        container.querySelectorAll('[data-project-status-action]').forEach(button => button.addEventListener('click', async () => {
            if (statusBusyId || deletingId || button.disabled) return;
            const targetId = button.dataset.projectStatusId;
            const action = button.dataset.projectStatusAction;
            if (!targetId || !action || typeof setupService.transitionProjectStatus !== 'function') return;
            statusBusyId = targetId;
            button.disabled = true;
            try {
                const result = await setupService.transitionProjectStatus(targetId, action);
                const fresh = result.state || await setupService.getState();
                currentProjects = fresh.projects;
                currentActiveId = fresh.activeProjectId;
                currentDefaultId = fresh.defaultProjectId;
                const description = action === 'archive' ? 'Obra archivada, historial conservado.'
                    : action === 'close' ? 'Obra cerrada para nuevas operaciones.'
                    : action === 'unarchive' ? 'Obra fuera del archivo. Puedes reabrirla.'
                    : 'Obra reabierta.';
                window.showNotification?.(description, 'success');
            } catch (error) {
                deleteError = error?.message || 'No se pudo cambiar el estado de la obra.';
            } finally {
                statusBusyId = null;
                await refreshUsage();
                render();
            }
        }));
        container.querySelectorAll('[data-project-impact]').forEach(button => button.addEventListener('click', async () => {
            if (typeof setupService.previewProjectDeletion !== 'function') return;
            button.disabled = true;
            try {
                const report = await setupService.previewProjectDeletion(button.dataset.projectImpact);
                const names = {
                    employees: 'Empleados', positions: 'Puestos', leaders: 'Líderes',
                    attendance: 'Asistencias', loans: 'Préstamos', payrollClosures: 'Cierres',
                    pettyCash: 'Caja chica', other: 'Relaciones adicionales', pending: 'Sincronizaciones pendientes'
                };
                const host = button.closest('[data-project-delete-protected]');
                const previous = host?.querySelector('[data-project-impact-report]');
                previous?.remove();
                if (host) {
                    const details = document.createElement('div');
                    details.setAttribute('data-project-impact-report', '');
                    details.setAttribute('role', 'status');
                    const rows = report.blockers.map(item =>
                        '<li>' + esc(names[item.kind] || item.kind) + ': ' + item.count + '</li>').join('');
                    details.innerHTML = '<strong>Dependencias comprobadas en este dispositivo</strong>'
                        + '<ul>' + rows + '</ul><p>' + esc(report.warning) + '</p>'
                        + '<p>No se ha ejecutado ningún borrado ni creado un respaldo en esta revisión.</p>';
                    host.appendChild(details);
                }
            } catch (error) {
                deleteError = error?.message || 'No se pudieron revisar las dependencias.';
                render();
            } finally {
                button.disabled = false;
            }
        }));
        container.querySelectorAll('[data-project-name-conflict]').forEach(button => button.addEventListener('click', async () => {
            closeProjectListModal();
            window.closeProjectSetupModal?.();
            try { await openProjectNameConflicts(); }
            catch (error) { window.showNotification?.(error.message || String(error), 'error'); }
        }));
        container.querySelectorAll('[data-project-filter]').forEach(tab => tab.addEventListener('click', event => {
            event.preventDefault();
            const next = tab.getAttribute('data-project-filter');
            if (next && next !== currentFilter) { currentFilter = next; render(); onFilterChange?.(currentFilter); }
        }));
        if (shouldAllowSwitch) container.querySelectorAll('[data-project-switch]').forEach(btn => btn.addEventListener('click', async event => {
            event.preventDefault();
            const targetId = btn.getAttribute('data-project-switch');
            if (!targetId) return;
            if (typeof onSwitchProject === 'function') { await onSwitchProject(targetId, btn); return; }
            if (typeof isSettingsDraftDirty === 'function' && isSettingsDraftDirty()) {
                window.showNotification?.('Hay cambios sin guardar en la configuración. Guarda o cancela los cambios manualmente antes de cambiar de proyecto.', 'warning');
                return;
            }
            btn.disabled = true;
            btn.textContent = 'Cambiando…';
            try {
                const result = await setupService.switchActiveProject(targetId);
                if (result?.stale) return;
                const freshState = result?.state || await setupService.getState();
                currentActiveId = freshState.activeProjectId;
                currentProjects = freshState.projects;
                currentDefaultId = freshState.defaultProjectId;
                render();
                window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: { projectId: freshState.activeProjectId, switched: true } }));
                window.showNotification?.(`Proyecto activo: ${freshState.activeProject?.name || freshState.activeProjectId}`, 'success');
                window.render?.();
            } catch (err) { window.showNotification?.(String(err.message || err), 'error'); }
            finally { btn.disabled = false; }
        }));
    }
    async function refreshUsage() {
        if (typeof setupService.getProjectUsage !== 'function') return;
        const generation = ++usageGeneration;
        try {
            const next = await setupService.getProjectUsage(currentProjects);
            if (generation !== usageGeneration) return;
            usage = next;
        } catch (_) {
            if (generation !== usageGeneration) return;
            usage = {};
        }
        render();
    }
    render();
    void refreshUsage();
    return {
        getFilter: () => currentFilter,
        setFilter: filter => { currentFilter = filter; render(); },
        update: ({ projects: nextProjects, activeProjectId: nextActiveId, defaultProjectId: nextDefaultId } = {}) => {
            if (nextProjects !== undefined) currentProjects = Array.isArray(nextProjects) ? [...nextProjects] : [];
            if (nextActiveId !== undefined) currentActiveId = nextActiveId;
            if (nextDefaultId !== undefined) currentDefaultId = nextDefaultId;
            render();
            void refreshUsage();
        }
    };
}
export const renderProjectList = mountProjectList;
function modal() { return document.getElementById(MODAL_ID); }
export function closeProjectListModal() {
    detachProjectListA11y?.();
    detachProjectListA11y = null;
    modal()?.remove();
}

export async function openProjectListModal({ setupService = projectSetupService, onSwitchSuccess = null } = {}) {
    closeProjectListModal();
    const el = document.createElement('div');
    el.id = MODAL_ID;
    el.className = 'project-shell-overlay';
    el.innerHTML = `<section class="project-shell" role="dialog" aria-modal="true" aria-labelledby="project-list-title"><header class="project-shell-header"><div class="project-shell-identity">${ICONS.folder}</div><div class="project-shell-heading"><h2 id="project-list-title" class="project-shell-title">Proyectos</h2><div class="project-shell-subtitle">Obras y registros.</div></div><button type="button" class="project-action is-secondary" data-project-create-open aria-label="Nueva obra" title="Nueva obra" hidden>${ICONS.plus}<span>Nuevo proyecto</span></button><button type="button" class="project-icon-btn" data-project-list-close aria-label="Cerrar">${ICONS.close}</button></header><div class="project-shell-body" data-project-list-modal-body><div class="project-list-empty">Cargando proyectos…</div></div></section>`;
    el.querySelector('[data-project-list-close]').addEventListener('click', closeProjectListModal);
    el.addEventListener('click', event => { if (event.target === el) closeProjectListModal(); });
    document.body.appendChild(el);
    detachProjectListA11y?.({ restoreFocus: false });
    detachProjectListA11y = attachProjectDialogA11y(el, { onEscape: closeProjectListModal });

    const bodyEl = el.querySelector('[data-project-list-modal-body]');
    try {
        const state = await setupService.getState();
        if (!state.enabled) {
            bodyEl.innerHTML = `<div class="project-notice is-warning"><strong>Proyectos no está activado</strong><p>Para gestionar y visualizar proyectos por obra, activa Proyectos desde la configuración general.</p></div>`;
            return;
        }
        const createBtn = el.querySelector('[data-project-create-open]');
        if (createBtn) createBtn.hidden = false;
        bodyEl.innerHTML = `<div data-project-create-slot style="display:none;margin-bottom:16px"></div><div data-project-list-mount></div><div class="project-status-line" data-project-list-status aria-live="polite"></div>`;
        const createSlot = bodyEl.querySelector('[data-project-create-slot]');
        const listMount = bodyEl.querySelector('[data-project-list-mount]');
        const statusEl = bodyEl.querySelector('[data-project-list-status]');
        const listHandle = mountProjectList(listMount, {
            projects: state.projects, activeProjectId: state.activeProjectId, defaultProjectId: state.defaultProjectId, allowSwitch: true, setupService,
            onSwitchProject: async (targetId, button) => {
                if (typeof isSettingsDraftDirty === 'function' && isSettingsDraftDirty()) {
                    const msg = 'Hay cambios sin guardar en la configuración. Guarda o cancela los cambios manualmente antes de cambiar de proyecto.';
                    if (statusEl) { statusEl.textContent = msg; statusEl.className = 'project-status-line is-error'; }
                    window.showNotification?.(msg, 'warning');
                    return;
                }
                if (button) { button.disabled = true; button.textContent = 'Cambiando…'; }
                if (statusEl) { statusEl.textContent = 'Cambiando de proyecto…'; statusEl.className = 'project-status-line'; }
                try {
                    const result = await setupService.switchActiveProject(targetId);
                    if (result?.stale) return;
                    const freshState = result?.state || await setupService.getState();
                    listHandle.update({ projects: freshState.projects, activeProjectId: freshState.activeProjectId, defaultProjectId: freshState.defaultProjectId });
                    if (statusEl) { statusEl.textContent = `Proyecto activo: “${freshState.activeProject?.name || freshState.activeProjectId}”.`; statusEl.className = 'project-status-line is-success'; }
                    window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: { projectId: freshState.activeProjectId, switched: true } }));
                    window.showNotification?.(`Proyecto activo: ${freshState.activeProject?.name || freshState.activeProjectId}`, 'success');
                    window.render?.();
                    onSwitchSuccess?.(freshState);
                } catch (error) {
                    if (statusEl) { statusEl.textContent = `Error: ${error.message || error}`; statusEl.className = 'project-status-line is-error'; }
                    window.showNotification?.(String(error.message || error), 'error');
                } finally { if (button) button.disabled = false; }
            }
        });

        let isCreateOpen = false;
        const closeCreate = () => { isCreateOpen = false; if (createSlot) { createSlot.style.display = 'none'; createSlot.innerHTML = ''; } };
        const openCreate = () => {
            isCreateOpen = true;
            if (!createSlot) return;
            createSlot.style.display = 'block';
            // R04/Phase B: all creation entries use the structured onboarding.
            const handleCreateSuccess = async (createdProject, nextState) => {
                closeCreate();
                const freshState = nextState || await setupService.getState();
                listHandle.update({ projects: freshState.projects, activeProjectId: freshState.activeProjectId, defaultProjectId: freshState.defaultProjectId });
            };
            mountProjectOnboarding(createSlot, {
                setupService,
                onSuccess: handleCreateSuccess,
                onCancel: closeCreate
            });
            // Minimal compatibility path for legacy programmatic empty-project submits.
            if (createSlot && !createSlot.querySelector('[data-project-create-element]')) {
                const compatForm = document.createElement('form');
                compatForm.setAttribute('data-project-create-element', '');
                compatForm.style.display = 'none';
                compatForm.setAttribute('aria-hidden', 'true');
                compatForm.addEventListener('submit', async event => {
                    event?.preventDefault?.();
                    const nameInput = createSlot.querySelector('[data-project-create-name]');
                    const rawValue = nameInput?.value ?? '';
                    try {
                        const result = await setupService.createEmptyProject({ name: rawValue });
                        window.showNotification?.(`Proyecto creado: ${result.project?.name || ''}`, 'success');
                        window.dispatchEvent(new CustomEvent('projects:created', { detail: { project: result.project } }));
                        await handleCreateSuccess(result.project, result.state);
                    } catch (error) {
                        window.showNotification?.(String(error?.message || error), 'error');
                    }
                });
                createSlot.appendChild(compatForm);
            }
        };
        createBtn?.addEventListener('click', () => { if (isCreateOpen) closeCreate(); else openCreate(); });
    } catch (error) {
        bodyEl.innerHTML = `<div class="project-notice is-danger"><strong>Error al cargar proyectos</strong><p>${esc(error.message || error)}</p></div>`;
    }
}

export { openProjectCreateModal, closeProjectCreateModal, mountProjectCreateForm };
export default { PROJECT_FILTERS, PROJECT_STATUS_META, formatProjectDate, calculateProjectStats, filterProjects, groupProjectsByStatus, renderProjectItemHTML, renderProjectListHTML, mountProjectList, renderProjectList, openProjectListModal, closeProjectListModal, openProjectCreateModal, closeProjectCreateModal, mountProjectCreateForm };
