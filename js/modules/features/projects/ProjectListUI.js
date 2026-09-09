import { PROJECT_STATUS } from './Project.js';
import { projectSetupService } from './ProjectSetupService.js';
import {
    mountProjectCreateForm,
    openProjectCreateModal,
    closeProjectCreateModal
} from './ProjectCreateUI.js';

export const PROJECT_FILTERS = Object.freeze({
    ALL: 'all',
    ACTIVE: PROJECT_STATUS.ACTIVE,
    CLOSED: PROJECT_STATUS.CLOSED,
    ARCHIVED: PROJECT_STATUS.ARCHIVED
});

export const PROJECT_STATUS_META = Object.freeze({
    [PROJECT_STATUS.ACTIVE]: Object.freeze({
        label: 'Activo',
        badgeClass: 'badge-status-active',
        icon: '🟢',
        color: '#15803d',
        bg: 'rgba(22, 163, 74, 0.12)',
        border: 'rgba(22, 163, 74, 0.35)',
        description: 'Proyecto en curso'
    }),
    [PROJECT_STATUS.CLOSED]: Object.freeze({
        label: 'Cerrado',
        badgeClass: 'badge-status-closed',
        icon: '🔒',
        color: '#c2410c',
        bg: 'rgba(234, 88, 12, 0.12)',
        border: 'rgba(234, 88, 12, 0.35)',
        description: 'Cerrado para operaciones'
    }),
    [PROJECT_STATUS.ARCHIVED]: Object.freeze({
        label: 'Archivado',
        badgeClass: 'badge-status-archived',
        icon: '📦',
        color: '#475569',
        bg: 'rgba(100, 116, 139, 0.12)',
        border: 'rgba(100, 116, 139, 0.35)',
        description: 'Archivado visualmente'
    })
});

const MODAL_ID = 'project-list-modal';

function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
}

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
    let active = 0;
    let closed = 0;
    let archived = 0;
    for (const p of list) {
        if (p?.status === PROJECT_STATUS.ACTIVE) active++;
        else if (p?.status === PROJECT_STATUS.CLOSED) closed++;
        else if (p?.status === PROJECT_STATUS.ARCHIVED) archived++;
    }
    return {
        total: list.length,
        active,
        closed,
        archived
    };
}

export function filterProjects(projects = [], filter = PROJECT_FILTERS.ALL) {
    const list = Array.isArray(projects) ? projects : [];
    if (!filter || filter === PROJECT_FILTERS.ALL) return [...list];
    return list.filter(p => p?.status === filter);
}

export function groupProjectsByStatus(projects = []) {
    const list = Array.isArray(projects) ? projects : [];
    const grouped = {
        [PROJECT_STATUS.ACTIVE]: [],
        [PROJECT_STATUS.CLOSED]: [],
        [PROJECT_STATUS.ARCHIVED]: []
    };
    for (const p of list) {
        if (grouped[p?.status]) {
            grouped[p.status].push(p);
        } else {
            grouped[PROJECT_STATUS.ACTIVE].push(p);
        }
    }
    return grouped;
}

export function renderProjectItemHTML(project, { activeProjectId = null, defaultProjectId = null } = {}) {
    if (!project) return '';
    const statusMeta = PROJECT_STATUS_META[project.status] || PROJECT_STATUS_META[PROJECT_STATUS.ACTIVE];
    const isActiveContext = !!(activeProjectId && String(project.id) === String(activeProjectId));
    const isDefault = !!(defaultProjectId && String(project.id) === String(defaultProjectId));

    return `
        <li class="project-item" data-project-id="${esc(project.id)}" data-project-status="${esc(project.status)}" style="padding:14px;border:1px solid rgba(148,163,184,.28);border-radius:12px;background:var(--card-bg,#fff);list-style:none;margin-bottom:10px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px">
                        <span class="project-badge ${statusMeta.badgeClass}" data-status-badge="${esc(project.status)}" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;background:${statusMeta.bg};color:${statusMeta.color};border:1px solid ${statusMeta.border}">
                            <span>${statusMeta.icon}</span>
                            <span>${esc(statusMeta.label)}</span>
                        </span>
                        ${isActiveContext ? `
                            <span class="project-badge badge-active-context" data-active-context-badge="true" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;background:rgba(37,99,235,.12);color:#1d4ed8;border:1px solid rgba(37,99,235,.32)">
                                <span>⭐</span>
                                <span>En uso</span>
                            </span>` : ''}
                        ${isDefault ? `
                            <span class="project-badge badge-default-project" data-default-project-badge="true" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;background:rgba(100,116,139,.12);color:#334155;border:1px solid rgba(100,116,139,.3)">
                                <span>🏠</span>
                                <span>Inicial</span>
                            </span>` : ''}
                    </div>
                    <div class="project-name" data-project-name-display style="font-weight:700;font-size:15px;color:var(--text-color,#111827);word-break:break-word">
                        ${esc(project.name || 'Sin nombre')}
                    </div>
                    <div class="project-id" data-project-id-display style="font-family:monospace;font-size:11px;opacity:.65;margin-top:2px;word-break:break-all">
                        ${esc(project.id)}
                    </div>
                </div>
                <div style="font-size:11px;opacity:.75;line-height:1.45;text-align:right">
                    <div>Creado: <strong>${formatProjectDate(project.createdAt)}</strong></div>
                    ${project.closedAt ? `<div>Cerrado: <strong>${formatProjectDate(project.closedAt)}</strong></div>` : ''}
                    ${project.archivedAt ? `<div>Archivado: <strong>${formatProjectDate(project.archivedAt)}</strong></div>` : ''}
                </div>
            </div>
            ${project.metadata?.notes ? `
                <div style="margin-top:8px;font-size:12px;opacity:.85;font-style:italic;background:rgba(148,163,184,.08);padding:6px 10px;border-radius:6px;border-left:3px solid rgba(148,163,184,.4)">
                    ${esc(project.metadata.notes)}
                </div>` : ''}
            ${project.metadata?.clonedFrom ? `
                <div style="margin-top:6px;font-size:11px;opacity:.65">
                    Basado en: <code>${esc(project.metadata.clonedFrom.sourceProjectId || 'otro proyecto')}</code>
                </div>` : ''}
        </li>`;
}

function renderSectionGroup(title, icon, items, options) {
    if (!items || items.length === 0) return '';
    return `
        <div class="project-status-group" style="margin-bottom:18px">
            <div style="font-size:12px;font-weight:700;opacity:.75;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;display:flex;align-items:center;gap:6px">
                <span>${icon}</span>
                <span>${esc(title)} (${items.length})</span>
            </div>
            <ul class="project-list" role="list" style="margin:0;padding:0">
                ${items.map(p => renderProjectItemHTML(p, options)).join('')}
            </ul>
        </div>`;
}

export function renderProjectListHTML({
    projects = [],
    activeProjectId = null,
    defaultProjectId = null,
    currentFilter = PROJECT_FILTERS.ALL
} = {}) {
    const list = Array.isArray(projects) ? projects : [];
    const stats = calculateProjectStats(list);
    const options = { activeProjectId, defaultProjectId };

    const tabStyle = (filterKey) => `
        border:0;
        border-radius:8px;
        padding:6px 12px;
        font-size:12px;
        font-weight:700;
        cursor:pointer;
        transition:background 0.15s ease;
        background:${currentFilter === filterKey ? '#2563eb' : 'rgba(148,163,184,.15)'};
        color:${currentFilter === filterKey ? '#ffffff' : 'inherit'};
    `;

    const summaryTabsHTML = `
        <div class="project-list-tabs" role="tablist" aria-label="Filtrar proyectos por estado" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
            <button type="button" class="project-filter-tab ${currentFilter === PROJECT_FILTERS.ALL ? 'is-active' : ''}" data-project-filter="${PROJECT_FILTERS.ALL}" role="tab" aria-selected="${currentFilter === PROJECT_FILTERS.ALL}" style="${tabStyle(PROJECT_FILTERS.ALL)}">
                Todos (${stats.total})
            </button>
            <button type="button" class="project-filter-tab ${currentFilter === PROJECT_FILTERS.ACTIVE ? 'is-active' : ''}" data-project-filter="${PROJECT_FILTERS.ACTIVE}" role="tab" aria-selected="${currentFilter === PROJECT_FILTERS.ACTIVE}" style="${tabStyle(PROJECT_FILTERS.ACTIVE)}">
                🟢 Activos (${stats.active})
            </button>
            <button type="button" class="project-filter-tab ${currentFilter === PROJECT_FILTERS.CLOSED ? 'is-active' : ''}" data-project-filter="${PROJECT_FILTERS.CLOSED}" role="tab" aria-selected="${currentFilter === PROJECT_FILTERS.CLOSED}" style="${tabStyle(PROJECT_FILTERS.CLOSED)}">
                🔒 Cerrados (${stats.closed})
            </button>
            <button type="button" class="project-filter-tab ${currentFilter === PROJECT_FILTERS.ARCHIVED ? 'is-active' : ''}" data-project-filter="${PROJECT_FILTERS.ARCHIVED}" role="tab" aria-selected="${currentFilter === PROJECT_FILTERS.ARCHIVED}" style="${tabStyle(PROJECT_FILTERS.ARCHIVED)}">
                📦 Archivados (${stats.archived})
            </button>
        </div>`;

    if (stats.total === 0) {
        return `
            ${summaryTabsHTML}
            <div class="project-list-empty" data-empty-state="all" style="padding:24px;text-align:center;border:1px dashed rgba(148,163,184,.35);border-radius:12px;opacity:.7;font-size:13px">
                No hay proyectos registrados en el sistema.
            </div>`;
    }

    let listBodyHTML = '';

    if (currentFilter === PROJECT_FILTERS.ALL) {
        const grouped = groupProjectsByStatus(list);
        const activeSection = renderSectionGroup('Proyectos activos', '🟢', grouped[PROJECT_STATUS.ACTIVE], options);
        const closedSection = renderSectionGroup('Proyectos cerrados', '🔒', grouped[PROJECT_STATUS.CLOSED], options);
        const archivedSection = renderSectionGroup('Proyectos archivados', '📦', grouped[PROJECT_STATUS.ARCHIVED], options);

        listBodyHTML = `
            <div class="project-list-grouped" data-projects-list>
                ${activeSection}
                ${closedSection}
                ${archivedSection}
            </div>`;
    } else {
        const filtered = filterProjects(list, currentFilter);
        if (filtered.length === 0) {
            const filterLabel = currentFilter === PROJECT_FILTERS.ACTIVE ? 'activos'
                : currentFilter === PROJECT_FILTERS.CLOSED ? 'cerrados' : 'archivados';
            listBodyHTML = `
                <div class="project-list-empty" data-empty-state="${esc(currentFilter)}" style="padding:24px;text-align:center;border:1px dashed rgba(148,163,184,.35);border-radius:12px;opacity:.7;font-size:13px">
                    No hay proyectos ${esc(filterLabel)}.
                </div>`;
        } else {
            listBodyHTML = `
                <ul class="project-list" role="list" data-projects-list style="margin:0;padding:0">
                    ${filtered.map(p => renderProjectItemHTML(p, options)).join('')}
                </ul>`;
        }
    }

    return `
        <div class="project-list-container" data-project-list-view>
            ${summaryTabsHTML}
            ${listBodyHTML}
        </div>`;
}

export function mountProjectList(container, {
    projects = [],
    activeProjectId = null,
    defaultProjectId = null,
    initialFilter = PROJECT_FILTERS.ALL,
    onFilterChange = null
} = {}) {
    if (!container) return null;
    let currentProjects = Array.isArray(projects) ? [...projects] : [];
    let currentActiveId = activeProjectId;
    let currentDefaultId = defaultProjectId;
    let currentFilter = initialFilter;

    function render() {
        container.innerHTML = renderProjectListHTML({
            projects: currentProjects,
            activeProjectId: currentActiveId,
            defaultProjectId: currentDefaultId,
            currentFilter
        });

        const tabs = container.querySelectorAll('[data-project-filter]');
        tabs.forEach(tab => {
            tab.addEventListener('click', (event) => {
                event.preventDefault();
                const nextFilter = tab.getAttribute('data-project-filter');
                if (nextFilter && nextFilter !== currentFilter) {
                    currentFilter = nextFilter;
                    render();
                    onFilterChange?.(currentFilter);
                }
            });
        });
    }

    render();

    return {
        getFilter: () => currentFilter,
        setFilter: (filter) => {
            currentFilter = filter;
            render();
        },
        update: ({ projects: nextProjects, activeProjectId: nextActiveId, defaultProjectId: nextDefaultId } = {}) => {
            if (nextProjects !== undefined) currentProjects = Array.isArray(nextProjects) ? [...nextProjects] : [];
            if (nextActiveId !== undefined) currentActiveId = nextActiveId;
            if (nextDefaultId !== undefined) currentDefaultId = nextDefaultId;
            render();
        }
    };
}

export const renderProjectList = mountProjectList;

function modal() { return document.getElementById(MODAL_ID); }

export function closeProjectListModal() {
    modal()?.remove();
}

export async function openProjectListModal({ setupService = projectSetupService } = {}) {
    closeProjectListModal();

    const el = document.createElement('div');
    el.id = MODAL_ID;
    el.style.cssText = 'position:fixed;inset:0;z-index:10060;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:16px;';
    el.innerHTML = `
        <section role="dialog" aria-modal="true" aria-labelledby="project-list-title" style="width:min(660px,100%);max-height:92vh;overflow:auto;background:var(--card-bg,#fff);color:var(--text-color,#111827);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.3);">
            <header style="display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid rgba(148,163,184,.28);position:sticky;top:0;background:inherit;z-index:2">
                <div style="font-size:24px">📂</div>
                <div style="flex:1">
                    <strong id="project-list-title" style="font-size:18px">Listado de proyectos</strong>
                    <div style="font-size:12px;opacity:.68">Vista oficial de proyectos activos, cerrados y archivados</div>
                </div>
                <button type="button" data-project-create-open style="display:none;border:0;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;background:#2563eb;color:#fff;cursor:pointer;align-items:center;gap:4px">
                    <span>➕</span>
                    <span>Nuevo proyecto</span>
                </button>
                <button type="button" data-project-list-close aria-label="Cerrar" style="border:0;background:transparent;color:inherit;font-size:28px;cursor:pointer">×</button>
            </header>
            <div data-project-list-modal-body style="padding:18px 20px">
                <div style="text-align:center;padding:20px;opacity:.7">Cargando proyectos…</div>
            </div>
        </section>`;

    el.querySelector('[data-project-list-close]').addEventListener('click', closeProjectListModal);
    el.addEventListener('click', event => { if (event.target === el) closeProjectListModal(); });
    document.body.appendChild(el);

    const bodyEl = el.querySelector('[data-project-list-modal-body]');
    try {
        const state = await setupService.getState();
        if (!state.enabled) {
            bodyEl.innerHTML = `
                <div style="border:1px solid rgba(245,158,11,.38);background:rgba(245,158,11,.08);border-radius:14px;padding:14px;line-height:1.5">
                    <strong>Proyectos no está activado</strong>
                    <p style="font-size:13px;margin:7px 0 0">Para gestionar y visualizar proyectos por obra, activa la infraestructura de Proyectos desde la configuración general.</p>
                </div>`;
            return;
        }

        const createBtn = el.querySelector('[data-project-create-open]');
        if (createBtn) createBtn.style.display = 'inline-flex';

        bodyEl.innerHTML = `
            <div data-project-create-slot style="display:none;margin-bottom:16px"></div>
            <div data-project-list-mount></div>`;

        const createSlot = bodyEl.querySelector('[data-project-create-slot]');
        const listMount = bodyEl.querySelector('[data-project-list-mount]');
        const listHandle = mountProjectList(listMount, {
            projects: state.projects,
            activeProjectId: state.activeProjectId,
            defaultProjectId: state.defaultProjectId
        });

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
                    setupService,
                    onSuccess: async (createdProject, nextState) => {
                        closeCreate();
                        const freshState = nextState || await setupService.getState();
                        listHandle.update({
                            projects: freshState.projects,
                            activeProjectId: freshState.activeProjectId,
                            defaultProjectId: freshState.defaultProjectId
                        });
                    },
                    onCancel: closeCreate
                });
            }
        };

        createBtn?.addEventListener('click', () => {
            if (isCreateOpen) closeCreate();
            else openCreate();
        });
    } catch (error) {
        bodyEl.innerHTML = `
            <div style="border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.07);border-radius:14px;padding:14px;color:#dc2626">
                <strong>Error al cargar proyectos:</strong> ${esc(error.message || error)}
            </div>`;
    }
}

export {
    openProjectCreateModal,
    closeProjectCreateModal,
    mountProjectCreateForm
};

export default {
    PROJECT_FILTERS,
    PROJECT_STATUS_META,
    formatProjectDate,
    calculateProjectStats,
    filterProjects,
    groupProjectsByStatus,
    renderProjectItemHTML,
    renderProjectListHTML,
    mountProjectList,
    renderProjectList,
    openProjectListModal,
    closeProjectListModal,
    openProjectCreateModal,
    closeProjectCreateModal,
    mountProjectCreateForm
};
