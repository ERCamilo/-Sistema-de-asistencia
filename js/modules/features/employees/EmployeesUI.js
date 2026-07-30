import icons from '../../ui/IconSystem.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { slugify } from '../../utils/Helpers.js';
import { Modal } from '../../components/Modal.js';
import { EmptyState } from '../../components/EmptyState.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { EmployeeModal } from '../../ui/modals/EmployeeModal.js';
import { LeaderModal } from '../../ui/modals/LeaderModal.js';
import { PositionModal } from '../../ui/modals/PositionModal.js';
import { PositionIconModal } from '../../ui/modals/PositionIconModal.js';
import { LeaderIconModal } from '../../ui/modals/LeaderIconModal.js';
import { EmployeeFloatingCard } from '../../ui/components/EmployeeFloatingCard.js';
import { state as _appState, stateManager } from '../../core/AppState.js';
import { EmployeeCard, getEmployeeOpenFilter } from './EmployeesList.js';
import { LeaderCard, scheduleLeaderCardGridLayout } from './LeadersList.js';
import { PositionCard, schedulePositionCardGridLayout } from './PositionsList.js';
import {
    renderPositionIconSvg,
    renderPositionUiSvg,
    resolveLeaderIcon,
    resolvePositionIcon,
    safePositionColor
} from './PositionVisuals.js';

export let context = null;

// Mapa de acciones para event delegation (data-action)
// Las funciones se resuelven en runtime contra window.* para mantener compat con código legacy.
// Los handlers reciben (arg, targetEl, event) para soportar acciones con DOM closures.
const _ACTION_MAP = {
    'open-employee-profile': (id) => window.openEmployeeProfile?.(id),
    'open-employee-form': (id) => window.openEmployeeForm?.(id || undefined),
    'open-employee-floating': (id) => window.openEmployeeFloating?.(id),
    'toggle-employee-status': (id) => window.toggleEmployeeStatus?.(id),
    'delete-employee': (id) => window.deleteEmployeeHandler?.(id),
    'open-employee-editor': (id) => window.openEmployeeEditor?.(id),
    'open-leader-form': (id) => window.openLeaderForm?.(id || undefined),
    'open-leader-icon': (id) => LeaderIconModal.open(id),
    'toggle-leader-status': (id) => window.toggleLeaderStatus?.(id),
    'toggle-leader-employees': (id) => window.toggleLeaderEmployees?.(id),
    'set-leader-sort-by': (mode) => window.setLeaderSortBy?.(mode),
    'open-position-form': (id) => window.openPositionForm?.(id || undefined),
    'open-position-icon': (id) => PositionIconModal.open(id),
    'toggle-position-status': (id) => window.togglePositionStatus?.(id),
    'toggle-position-employees': (id) => window.togglePositionEmployees?.(id),
    'delete-position': (id) => window.deletePosition?.(id),
    'reset-employee-filters': () => window.resetEmployeeFilters?.(),
    'change-view-mode': (mode) => window.changeEmployeeViewMode?.(mode),
    'set-position-sort-by': (mode) => window.setPositionSortBy?.(mode),
    'set-employee-salary-view': (mode) => window.setEmployeeSalaryView?.(mode),
    'set-employee-status-filter': (status) => window.setEmployeeStatusFilter?.(status),
    'close-employee-filter': (_, el, event) => {
        event.preventDefault();
        closeEmployeeMultiFilter(el.closest('.employee-multifilter'), true);
    },
    // DOM closures (no necesitan llamar a window): manipulación local
    'open-search': (_, el) => {
        const w = el.closest('.employee-search');
        if (!w) return;
        w.classList.add('open');
        const i = w.querySelector('input');
        if (i) i.focus();
    },
    'clear-search-position': (_, el) => {
        window.setPositionSearchFilter?.('');
        const w = el.closest('.employee-search');
        if (w) w.classList.remove('open');
    },
    'clear-search-employee': (_, el) => {
        window.setEmployeeSearchFilter?.('');
        const w = el.closest('.employee-search');
        if (w) w.classList.remove('open');
    },
    'open-filter-pill': (_, el) => {
        const pill = el.closest('.filter-pill');
        if (pill) pill.classList.add('open');
    }
};

function closeEmployeeMultiFilter(filter, restoreFocus = false) {
    if (!filter?.open) return;
    filter.open = false;
    if (restoreFocus) filter.querySelector('summary')?.focus();
}

function closeOtherEmployeeMultiFilters(activeFilter = null) {
    document.querySelectorAll('.employee-multifilter[open]').forEach(filter => {
        if (filter !== activeFilter) closeEmployeeMultiFilter(filter);
    });
}

function _handleDelegatedClick(e) {
    const activeFilter = e.target?.closest?.('.employee-multifilter') || null;
    closeOtherEmployeeMultiFilters(activeFilter);

    const target = e.target?.closest?.('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const handler = _ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id || target.dataset.value || null;
    handler(arg, target, e);
}

// Soporte de teclado para role="button" con data-action (Enter/Space)
function _handleDelegatedKeydown(e) {
    if (e.key === 'Escape') {
        const openFilter = document.querySelector('.employee-multifilter[open]');
        if (!openFilter) return;
        e.preventDefault();
        closeEmployeeMultiFilter(openFilter, true);
        return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-action]');
    if (!target || target.tagName === 'BUTTON' || target.tagName === 'A') return;
    if (target.getAttribute('role') !== 'button') return;
    e.preventDefault();
    _handleDelegatedClick(e);
}

let _delegationAttached = false;
let _employeeEditorFrame = null;

function scheduleEmployeeEditorPanel(employeeId) {
    if (typeof requestAnimationFrame !== 'function') return;
    if (_employeeEditorFrame) cancelAnimationFrame(_employeeEditorFrame);
    _employeeEditorFrame = requestAnimationFrame(() => {
        _employeeEditorFrame = null;
        const host = document.getElementById('employee-editor-panel');
        if (!host) return;
        if (!employeeId) {
            host.innerHTML = `
                <div class="employee-editor-panel__empty">
                    <strong>Sin empleado seleccionado</strong>
                    <span>Ajusta los filtros para editar un empleado.</span>
                </div>
            `;
            return;
        }
        EmployeeModal.open(employeeId, { inlineHost: host });
    });
}

export function init(ctx) {
    context = ctx;
    if (!_delegationAttached) {
        document.addEventListener('click', _handleDelegatedClick);
        document.addEventListener('keydown', _handleDelegatedKeydown);
        _delegationAttached = true;
    }
}

// Helper to access state easier — falls back to global AppState when context is not yet initialized (e.g. in tests)
export function getState() {
    return context ? context.state : _appState;
}

function getServices() {
    return context.services;
}

function renderEmployeeMultiFilter({
    kind,
    label,
    searchPlaceholder,
    items,
    selectedIds,
    toggleHandler,
    iconResolver,
    colorResolver
}) {
    const selected = new Set(selectedIds);
    const count = selected.size;
    const isOpen = getEmployeeOpenFilter() === kind;
    return `
        <details class="employee-multifilter${count ? ' has-selection' : ''}"
                 data-filter-kind="${escapeAttr(kind)}"
                 ${isOpen ? 'open' : ''}
                 ontoggle="setEmployeeFilterMenuOpen('${kind}', this.open)">
            <summary aria-label="${escapeAttr(`Filtrar por ${label.toLowerCase()}`)}">
                ${renderPositionUiSvg(kind === 'positions' ? 'filter' : 'leader', { size: 15 })}
                <span>${escapeHTML(label)}</span>
                ${count ? `<strong>${count}</strong>` : ''}
            </summary>
            <button type="button"
                    class="employee-multifilter__backdrop"
                    data-action="close-employee-filter"
                    aria-label="${escapeAttr(`Cerrar filtro de ${label.toLowerCase()}`)}"
                    tabindex="-1"></button>
            <div class="employee-multifilter__popover"
                 role="dialog"
                 aria-label="${escapeAttr(`Filtrar por ${label.toLowerCase()}`)}">
                <div class="employee-multifilter__header">
                    <strong>Filtrar por ${escapeHTML(label.toLowerCase())}</strong>
                    <button type="button"
                            data-action="close-employee-filter"
                            aria-label="${escapeAttr(`Cerrar filtro de ${label.toLowerCase()}`)}">
                        ${renderPositionUiSvg('close', { size: 17 })}
                    </button>
                </div>
                <label class="employee-multifilter__search">
                    ${renderPositionUiSvg('search', { size: 15 })}
                    <input type="search"
                           placeholder="${escapeAttr(searchPlaceholder)}"
                           oninput="filterEmployeeFilterOptions(this)">
                </label>
                <div class="employee-multifilter__options">
                    ${items.map(item => {
                        const itemId = String(item.id);
                        const checked = selected.has(itemId);
                        const color = colorResolver ? colorResolver(item) : '#64748b';
                        return `
                            <label data-filter-label="${escapeAttr(item.name || '')}">
                                <span class="employee-multifilter__option-icon"
                                      style="--filter-option-color: ${safePositionColor(color, '#64748b')};">
                                    ${renderPositionIconSvg(iconResolver(item), { size: 17 })}
                                </span>
                                <span>${escapeHTML(item.name || 'Sin nombre')}</span>
                                <input type="checkbox"
                                       value="${escapeAttr(itemId)}"
                                       ${checked ? 'checked' : ''}
                                       onchange="${toggleHandler}(this.value, this.checked)">
                                <span class="employee-multifilter__check" aria-hidden="true">
                                    ${renderPositionUiSvg('check', { size: 13 })}
                                </span>
                            </label>
                        `;
                    }).join('')}
                </div>
            </div>
        </details>
    `;
}

// ============================================
// EMPLOYEES TAB
// ============================================


export function EmployeesTab() {
    const state = getState();
    const subTab = state.employeeViewMode || 'employees'; // 'employees', 'leaders', 'positions'
    const isEmployees = subTab === 'employees';
    const isLeaders = subTab === 'leaders';
    const isPositions = subTab === 'positions';
    const activeEmployees = state.employees.filter(employee => employee.active !== false).length;
    const sectionLabel = isEmployees ? 'Empleados' : isLeaders ? 'Líderes' : 'Puestos';

    const subTabsHTML = `
                <section class="personnel-page">
                    <header class="personnel-page__header">
                        <div>
                            <div class="personnel-page__title">
                                <h1>Personal</h1>
                                <span class="personnel-page__context">${sectionLabel}</span>
                            </div>
                            <p>${activeEmployees} activos · ${state.employees.length} empleados · ${state.leaders.length} líderes · ${state.positions.length} puestos</p>
                        </div>
                    </header>
                    <nav class="personnel-tabs" aria-label="Secciones de personal">
                        <button class="${isEmployees ? 'active' : ''}"
                                type="button"
                                data-action="change-view-mode" data-value="employees"
                                aria-label="Ver empleados">
                            ${icons.get('user', { size: 16 })} <span>Empleados</span> <strong>${state.employees.length}</strong>
                        </button>
                        <button class="${isLeaders ? 'active' : ''}"
                                type="button"
                                data-action="change-view-mode" data-value="leaders"
                                aria-label="Ver líderes">
                            ${icons.get('personnel', { size: 16 })} <span>Líderes</span> <strong>${state.leaders.length}</strong>
                        </button>
                        <button class="${isPositions ? 'active' : ''}"
                                type="button"
                                data-action="change-view-mode" data-value="positions"
                                aria-label="Ver posiciones">
                            ${icons.get('briefcase', { size: 16 })} <span>Puestos</span> <strong>${state.positions.length}</strong>
                        </button>
                    </nav>
            `;

    // Si es posiciones, mostrar contenido de posiciones
    if (isPositions) {
        const positionFilters = state.positionFilters || {
            search: '',
            leaderId: 'all',
            status: state.positionStatusFilter || 'active'
        };
        const statusFilter = positionFilters.status || state.positionStatusFilter || 'active';
        const selectedLeader = positionFilters.leaderId !== 'all'
            ? state.leaders.find(l => l.id === positionFilters.leaderId)
            : null;
        const statusLabel = statusFilter === 'inactive' ? 'Inactivas' : (statusFilter === 'all' ? 'Todas' : 'Activas');
        const sortBy = state.positionSortBy || 'employees';
        const activeExtraFilters = (positionFilters.leaderId !== 'all' ? 1 : 0)
            + (statusFilter !== 'active' ? 1 : 0);

        let filteredPositions = state.positions.filter(pos => {
            if (statusFilter === 'active') return pos.active;
            if (statusFilter === 'inactive') return !pos.active;
            return true;
        });

        const searchValue = (positionFilters.search || '').trim().toLowerCase();
        if (positionFilters.leaderId && positionFilters.leaderId !== 'all') {
            filteredPositions = filteredPositions.filter(pos => pos.leaderId === positionFilters.leaderId);
        }
        if (searchValue) {
            filteredPositions = filteredPositions.filter(pos => {
                const nameMatch = (pos.name || '').toLowerCase().includes(searchValue);
                const leader = pos.leaderId ? state.leaders.find(l => l.id === pos.leaderId) : null;
                const leaderMatch = leader && leader.name && leader.name.toLowerCase().includes(searchValue);
                return nameMatch || leaderMatch;
            });
        }

        const employeeCountByPosition = new Map();
        state.employees.forEach(employee => {
            if (!employee.active) return;
            (employee.positions || []).forEach(positionId => {
                employeeCountByPosition.set(
                    positionId,
                    (employeeCountByPosition.get(positionId) || 0) + 1
                );
            });
        });

        filteredPositions.sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'salary') return Number(b.hourlyRate || 0) - Number(a.hourlyRate || 0);
            if (sortBy === 'employees') {
                const countDifference = (employeeCountByPosition.get(b.id) || 0)
                    - (employeeCountByPosition.get(a.id) || 0);
                if (countDifference !== 0) return countDifference;
            }
            return (a.name || '').localeCompare(b.name || '');
        });
        schedulePositionCardGridLayout();

        return `
                    ${subTabsHTML}
                    <div class="position-toolbar">
                        <label class="position-toolbar__search">
                            ${renderPositionUiSvg('search', { size: 17 })}
                            <input type="search"
                                   value="${escapeAttr(positionFilters.search || '')}"
                                   oninput="setPositionSearchFilter(this.value)"
                                   placeholder="Buscar posición...">
                            ${positionFilters.search ? `
                                <button type="button" data-action="clear-search-position"
                                        aria-label="Limpiar búsqueda">
                                    ${renderPositionUiSvg('close', { size: 15 })}
                                </button>
                            ` : ''}
                        </label>

                        <details class="position-toolbar__filters">
                            <summary aria-label="Filtros adicionales" title="Filtros">
                                ${renderPositionUiSvg('filter', { size: 16 })}
                                ${activeExtraFilters ? `<strong>${activeExtraFilters}</strong>` : ''}
                            </summary>
                            <div class="position-toolbar__filter-popover">
                                <label>
                                    <span>Líder</span>
                                    <select onchange="setPositionLeaderFilter(this.value)">
                                        <option value="all" ${(positionFilters.leaderId || 'all') === 'all' ? 'selected' : ''}>Todos</option>
                                        ${state.leaders.map(leader => `
                                            <option value="${escapeAttr(leader.id)}" ${positionFilters.leaderId === leader.id ? 'selected' : ''}>
                                                ${escapeHTML(leader.name)}
                                            </option>
                                        `).join('')}
                                    </select>
                                </label>
                                <label>
                                    <span>Estado</span>
                                    <select onchange="setPositionStatusFilter(this.value)">
                                        <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Activas</option>
                                        <option value="inactive" ${statusFilter === 'inactive' ? 'selected' : ''}>Inactivas</option>
                                        <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>Todas</option>
                                    </select>
                                </label>
                                <p>${selectedLeader ? `Líder: ${escapeHTML(selectedLeader.name)} · ` : ''}${statusLabel}</p>
                            </div>
                        </details>

                        <div class="position-toolbar__sort" aria-label="Ordenar puestos">
                            <button class="${sortBy === 'employees' ? 'active' : ''}" type="button"
                                    data-action="set-position-sort-by" data-value="employees">
                                Por empleados
                            </button>
                            <button class="${sortBy === 'name' ? 'active' : ''}" type="button"
                                    data-action="set-position-sort-by" data-value="name">
                                Por nombre
                            </button>
                            <button class="${sortBy === 'salary' ? 'active' : ''}" type="button"
                                    data-action="set-position-sort-by" data-value="salary">
                                Por tarifa
                            </button>
                        </div>

                        <button class="position-toolbar__add" type="button" data-action="open-position-form">
                            ${renderPositionUiSvg('add', { size: 17 })} Nueva posición
                        </button>
                    </div>
                    
                    <div class="position-card-grid">
                    ${filteredPositions.length === 0 ? EmptyState.render({
                        icon: 'briefcase',
                        title: `No hay posiciones ${statusFilter === 'active' ? 'activas' : statusFilter === 'inactive' ? 'inactivas' : ''}`.trim(),
                        description: statusFilter === 'active' ? 'Crea una posición o cambia el filtro para ver otras.' : 'Cambia el filtro para ver las posiciones disponibles.',
                        size: 'large'
                    }) : filteredPositions.map(PositionCard).join('')}
                    </div>
                </section>
                `;
    }

    // Si es empleados o líderes — usar lógica compartida
    const {
        filteredItems,
        statusFilter,
        positionFilter,
        leaderFilter,
        positionFilters,
        leaderFilters,
        selectedPosition,
        selectedLeader,
        statusLabel
    } = getFilteredEmployeesOrLeaders();
    const employeeFilters = state.employeeFilters || {
        search: '',
        positionId: 'all',
        leaderId: 'all',
        positionIds: [],
        leaderIds: [],
        status: 'active'
    };

    if (isLeaders) {
        const sortBy = state.leaderSortBy || 'employees';
        scheduleLeaderCardGridLayout();

        return `
                ${subTabsHTML}
                <div class="position-toolbar leader-toolbar">
                    <label class="position-toolbar__search">
                        ${renderPositionUiSvg('search', { size: 17 })}
                        <input type="search"
                               value="${escapeAttr(employeeFilters.search || '')}"
                               oninput="setEmployeeSearchFilter(this.value)"
                               placeholder="Buscar líder por nombre o código...">
                        ${employeeFilters.search ? `
                            <button type="button" data-action="clear-search-employee"
                                    aria-label="Limpiar búsqueda">
                                ${renderPositionUiSvg('close', { size: 15 })}
                            </button>
                        ` : ''}
                    </label>

                    <div class="position-toolbar__sort leader-toolbar__status" aria-label="Filtrar líderes por estado">
                        <button class="${statusFilter === 'active' ? 'active' : ''}" type="button"
                                data-action="set-employee-status-filter" data-value="active">
                            Activos
                        </button>
                        <button class="${statusFilter === 'inactive' ? 'active' : ''}" type="button"
                                data-action="set-employee-status-filter" data-value="inactive">
                            Inactivos
                        </button>
                        <button class="${statusFilter === 'all' ? 'active' : ''}" type="button"
                                data-action="set-employee-status-filter" data-value="all">
                            Todos
                        </button>
                    </div>

                    <div class="position-toolbar__sort leader-toolbar__sort" aria-label="Ordenar líderes">
                        <button class="${sortBy === 'employees' ? 'active' : ''}" type="button"
                                data-action="set-leader-sort-by" data-value="employees">
                            Por empleados
                        </button>
                        <button class="${sortBy === 'name' ? 'active' : ''}" type="button"
                                data-action="set-leader-sort-by" data-value="name">
                            Por nombre
                        </button>
                    </div>

                    <button class="position-toolbar__add" type="button" data-action="open-leader-form">
                        ${renderPositionUiSvg('add', { size: 17 })} Nuevo líder
                    </button>
                </div>

                <div id="employees-list" class="leader-card-grid" data-preserve-scroll="employees-list">
                    ${buildEmployeesListHTML()}
                </div>
            </section>
        `;
    }

    if (isEmployees) {
        const selectedEmployee = filteredItems.find(employee =>
            employee.id === state.selectedPersonnelEmployeeId
            || employee.key === state.selectedPersonnelEmployeeId
        ) || filteredItems[0] || null;
        const selectedEmployeeId = selectedEmployee?.key || selectedEmployee?.id || null;
        scheduleEmployeeEditorPanel(selectedEmployeeId);

        return `
                ${subTabsHTML}
                <div class="employee-toolbar">
                    <label class="position-toolbar__search employee-toolbar__search">
                        ${renderPositionUiSvg('search', { size: 17 })}
                        <input type="search"
                               value="${escapeAttr(employeeFilters.search || '')}"
                               oninput="setEmployeeSearchFilter(this.value)"
                               placeholder="Buscar por nombre, número o posición...">
                        ${employeeFilters.search ? `
                            <button type="button" data-action="clear-search-employee"
                                    aria-label="Limpiar búsqueda">
                                ${renderPositionUiSvg('close', { size: 15 })}
                            </button>
                        ` : ''}
                    </label>

                    <div class="employee-toolbar__multi-filters">
                        ${renderEmployeeMultiFilter({
                            kind: 'positions',
                            label: 'Puestos',
                            searchPlaceholder: 'Buscar puesto...',
                            items: state.positions.slice().sort((a, b) => a.name.localeCompare(b.name)),
                            selectedIds: positionFilters,
                            toggleHandler: 'toggleEmployeePositionFilter',
                            iconResolver: resolvePositionIcon,
                            colorResolver: position => position.color
                        })}
                        ${renderEmployeeMultiFilter({
                            kind: 'leaders',
                            label: 'Líderes',
                            searchPlaceholder: 'Buscar líder...',
                            items: state.leaders.filter(leader => leader.active)
                                .sort((a, b) => a.name.localeCompare(b.name)),
                            selectedIds: leaderFilters,
                            toggleHandler: 'toggleEmployeeLeaderFilter',
                            iconResolver: resolveLeaderIcon,
                            colorResolver: leader => leader.color
                        })}
                    </div>

                    <div class="position-toolbar__sort employee-toolbar__status"
                         aria-label="Filtrar empleados por estado">
                        <button class="${statusFilter === 'active' ? 'active' : ''}" type="button"
                                data-action="set-employee-status-filter" data-value="active">
                            Activos
                        </button>
                        <button class="${statusFilter === 'inactive' ? 'active' : ''}" type="button"
                                data-action="set-employee-status-filter" data-value="inactive">
                            Inactivos
                        </button>
                        <button class="${statusFilter === 'all' ? 'active' : ''}" type="button"
                                data-action="set-employee-status-filter" data-value="all">
                            Todos
                        </button>
                    </div>

                    <button class="position-toolbar__add" type="button" data-action="open-employee-form">
                        ${renderPositionUiSvg('add', { size: 17 })} Nuevo empleado
                    </button>
                </div>

                <div class="employee-workspace">
                    <section class="employee-table" aria-label="Listado de empleados">
                        <header class="employee-table__header">
                            <span>#</span>
                            <span>Empleado</span>
                            <span>Salario</span>
                            <span>Estado</span>
                            <span>Acciones</span>
                        </header>
                        <div id="employees-list" data-preserve-scroll="employees-list">
                            ${buildEmployeesListHTML(selectedEmployeeId)}
                        </div>
                    </section>
                    <aside id="employee-editor-panel" class="employee-editor-panel"
                           aria-label="Editor de empleado">
                        <div class="employee-editor-panel__loading">Cargando editor…</div>
                    </aside>
                </div>
            </section>
        `;
    }

    return `
                ${subTabsHTML}
                <div class="date-controls" style="margin-bottom: 16px;">
                    ${isEmployees ? `
                        <div class="search-container" style="margin-bottom: 12px; display: flex; gap: 10px; width: 100%; flex-wrap: wrap;">
                            <div class="employee-search${employeeFilters.search ? ' open' : ''}">
                                <button class="employee-search-btn"
                                        type="button"
                                        data-action="open-search" type="button"
                                        aria-label="Buscar">
                                    ${icons.get('search')}
                                </button>
                                <input type="text"
                                       value="${employeeFilters.search || ''}"
                                       oninput="setEmployeeSearchFilter(this.value)"
                                       onfocus="this.closest('.employee-search').classList.add('open')"
                                       onblur="if(!this.value){this.closest('.employee-search').classList.remove('open')}"
                                       placeholder="Buscar por nombre, número o posición..."
                                       class="employee-search-input">
                                ${employeeFilters.search ? `
                                    <button type="button" data-action="clear-search-employee"
                                            class="employee-search-clear"
                                            aria-label="Limpiar búsqueda">
                                        ${icons.get('close')}
                                    </button>
                                ` : ''}
                            </div>

                            <div class="filter-pill ${positionFilter !== 'all' ? 'active take-row' : ''}">
                                <button class="filter-pill-btn" type="button" data-action="open-filter-pill">
                                    ${icons.get('briefcase')}
                                </button>
                                <span class="filter-pill-label">
                                    ${selectedPosition ? `${selectedPosition.name}` : 'Posiciones: Todas'}
                                </span>
                                <select class="filter-pill-select"
                                        onchange="setEmployeePositionFilter(this.value)"
                                        onfocus="this.closest('.filter-pill').classList.add('open')"
                                        onblur="this.closest('.filter-pill').classList.remove('open')">
                                    <option value="all" ${(employeeFilters.positionId || 'all') === 'all' ? 'selected' : ''}>Todas las posiciones</option>
                                    ${state.positions.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => `
                                        <option value="${p.id}" ${employeeFilters.positionId === p.id ? 'selected' : ''}>
                                            ${p.name}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>

                            <div class="filter-pill ${leaderFilter !== 'all' ? 'active take-row' : ''}">
                                <button class="filter-pill-btn" type="button" data-action="open-filter-pill">
                                    ${icons.get('key')}
                                </button>
                                <span class="filter-pill-label">
                                    ${selectedLeader ? `Lider: ${selectedLeader.name}` : 'Lider: Todos'}
                                </span>
                                <select class="filter-pill-select"
                                        onchange="setEmployeeLeaderFilter(this.value)"
                                        onfocus="this.closest('.filter-pill').classList.add('open')"
                                        onblur="this.closest('.filter-pill').classList.remove('open')">
                                    <option value="all" ${(leaderFilter || 'all') === 'all' ? 'selected' : ''}>Todos los lideres</option>
                                    ${state.leaders.filter(l => l.active).sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(l => `
                                        <option value="${l.id}" ${leaderFilter === l.id ? 'selected' : ''}>
                                            ${l.name}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>

                            <div class="filter-pill ${statusFilter !== 'active' ? 'active take-row' : ''}">
                                <button class="filter-pill-btn" type="button" data-action="open-filter-pill">
                                    ${icons.get('check')}
                                </button>
                                <span class="filter-pill-label">${statusLabel}</span>
                                <select class="filter-pill-select"
                                        onchange="setEmployeeStatusFilter(this.value)"
                                        onfocus="this.closest('.filter-pill').classList.add('open')"
                                        onblur="this.closest('.filter-pill').classList.remove('open')">
                                    <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Activos</option>
                                    <option value="inactive" ${statusFilter === 'inactive' ? 'selected' : ''}>Desactivados</option>
                                    <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>Todos</option>
                                </select>
                            </div>

                            <button class="view-btn" type="button" data-action="reset-employee-filters" style="height: 40px; padding: 0 12px;" aria-label="Reiniciar filtros">
                                ${icons.get('refresh')} Reiniciar
                            </button>
                        </div>
                    ` : `
                        <div class="search-container">
                            <div class="employee-search${employeeFilters.search ? ' open' : ''}">
                                <button class="employee-search-btn"
                                        type="button"
                                        data-action="open-search"
                                        aria-label="Buscar líder">
                                    ${icons.get('search')}
                                </button>
                                <input type="text"
                                       value="${escapeAttr(employeeFilters.search || '')}"
                                       oninput="setEmployeeSearchFilter(this.value)"
                                       placeholder="Buscar líder por nombre o código..."
                                       class="employee-search-input">
                                ${employeeFilters.search ? `
                                    <button type="button" data-action="clear-search-employee"
                                            class="employee-search-clear"
                                            aria-label="Limpiar búsqueda">
                                        ${icons.get('close')}
                                    </button>
                                ` : ''}
                            </div>
                            <div class="personnel-segments">
                            <button class="view-btn ${statusFilter === 'active' ? 'active' : ''}" type="button" data-action="set-employee-status-filter" data-value="active" style="flex: 1;">
                                Activos
                            </button>
                            <button class="view-btn ${statusFilter === 'inactive' ? 'active' : ''}" type="button" data-action="set-employee-status-filter" data-value="inactive" style="flex: 1;">
                                Inactivos
                            </button>
                            <button class="view-btn ${statusFilter === 'all' ? 'active' : ''}" type="button" data-action="set-employee-status-filter" data-value="all" style="flex: 1;">
                                Todos
                            </button>
                            </div>
                        </div>
                    `}

                    <button class="view-btn" type="button" data-action="${isEmployees ? 'open-employee-form' : 'open-leader-form'}" style="width: 100%; margin-top: 12px; background: #06b6d4; color: #000; border-color: #06b6d4;">
                        ${icons.get('add')} Nuevo ${isEmployees ? 'Empleado' : 'Lider'}
                    </button>
                </div>
                
                <div id="employees-list" data-preserve-scroll="employees-list">
                    ${buildEmployeesListHTML()}
                </div>
            </section>
            `;
}

// ============================================
// SHARED FILTER LOGIC (eliminates duplication between EmployeesTab and buildEmployeesListHTML)
// ============================================

function getFilteredEmployeesOrLeaders() {
    const state = getState();
    const subTab = state.employeeViewMode || 'employees';
    const isEmployees = subTab === 'employees';

    // Live updates can briefly expose the same entity object more than once
    // while the local and cloud snapshots converge. The persisted stores use
    // the stable id as their key, so rendering that transient duplicate creates
    // two indistinguishable rows for one employee even though only one record
    // exists. Collapse only equal stable identities; employees that merely
    // share a number or name remain visible for the conflict tools to resolve.
    const sourceItems = isEmployees ? state.employees : state.leaders;
    const seenStableIds = new Set();
    const items = (Array.isArray(sourceItems) ? sourceItems : []).filter(item => {
        const stableId = item?.id ?? item?.key;
        if (stableId === undefined || stableId === null || stableId === '') return true;
        const normalizedId = String(stableId);
        if (seenStableIds.has(normalizedId)) return false;
        seenStableIds.add(normalizedId);
        return true;
    });
    const employeeFilters = state.employeeFilters || {
        search: '',
        positionId: 'all',
        leaderId: 'all',
        positionIds: [],
        leaderIds: [],
        status: state.employeeStatusFilter || 'active'
    };
    const statusFilter = employeeFilters.status || state.employeeStatusFilter || 'active';

    let filteredItems = items.filter(item => {
        if (statusFilter === 'active') return item.active;
        if (statusFilter === 'inactive') return !item.active;
        return true;
    });

    let positionFilter = 'all';
    let leaderFilter = 'all';
    let positionFilters = [];
    let leaderFilters = [];
    let selectedPosition = null;
    let selectedLeader = null;
    let statusLabel = 'Activos';

    if (isEmployees) {
        positionFilter = employeeFilters.positionId || 'all';
        leaderFilter = employeeFilters.leaderId || 'all';
        positionFilters = Array.isArray(employeeFilters.positionIds)
            ? [...new Set(employeeFilters.positionIds.filter(Boolean))]
            : (positionFilter !== 'all' ? [positionFilter] : []);
        leaderFilters = Array.isArray(employeeFilters.leaderIds)
            ? [...new Set(employeeFilters.leaderIds.filter(Boolean))]
            : (leaderFilter !== 'all' ? [leaderFilter] : []);
        const searchValue = (employeeFilters.search || '').trim().toLowerCase();
        selectedPosition = positionFilter !== 'all' ? state.positions.find(p => p.id === positionFilter) : null;
        selectedLeader = leaderFilter !== 'all' ? state.leaders.find(l => l.id === leaderFilter) : null;
        statusLabel = statusFilter === 'inactive' ? 'Desactivados' : (statusFilter === 'all' ? 'Todos' : 'Activos');

        if (positionFilters.length) {
            filteredItems = filteredItems.filter(emp =>
                (emp.positions || []).some(positionId => positionFilters.includes(positionId))
            );
        }
        if (leaderFilters.length) {
            const leaderPositions = state.positions
                .filter(p => leaderFilters.includes(p.leaderId))
                .map(p => p.id);
            filteredItems = filteredItems.filter(emp => (emp.positions || []).some(pid => leaderPositions.includes(pid)));
        }
        if (searchValue) {
            filteredItems = filteredItems.filter(emp => {
                const nameMatch = (emp.name || '').toLowerCase().includes(searchValue);
                const numberMatch = String(emp.number || '').toLowerCase().includes(searchValue);
                const positionMatch = (emp.positions || []).some(pid => {
                    const pos = state.positions.find(p => p.id === pid);
                    return pos && pos.name && pos.name.toLowerCase().includes(searchValue);
                });
                return nameMatch || numberMatch || positionMatch;
            });
        }
    } else {
        const searchValue = (employeeFilters.search || '').trim().toLowerCase();
        statusLabel = statusFilter === 'inactive' ? 'Inactivos' : (statusFilter === 'all' ? 'Todos' : 'Activos');
        if (searchValue) {
            filteredItems = filteredItems.filter(leader =>
                (leader.name || '').toLowerCase().includes(searchValue)
                || String(leader.number || '').toLowerCase().includes(searchValue)
            );
        }
    }

    const leaderEmployeeCounts = new Map();
    if (!isEmployees) {
        state.leaders.forEach(leader => {
            const positionIds = new Set(
                state.positions
                    .filter(position => position.active && position.leaderId === leader.id)
                    .map(position => position.id)
            );
            const employeeCount = state.employees.filter(employee =>
                employee.active && (employee.positions || []).some(id => positionIds.has(id))
            ).length;
            leaderEmployeeCounts.set(leader.id, employeeCount);
        });
    }

    filteredItems.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (isEmployees) {
            const aNum = parseInt(a.number, 10);
            const bNum = parseInt(b.number, 10);
            if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
            return String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true });
        }
        if ((state.leaderSortBy || 'employees') === 'employees') {
            const countDifference = (leaderEmployeeCounts.get(b.id) || 0)
                - (leaderEmployeeCounts.get(a.id) || 0);
            if (countDifference !== 0) return countDifference;
        }
        return (a.name || '').localeCompare(b.name || '');
    });

    return {
        filteredItems,
        statusFilter,
        positionFilter,
        leaderFilter,
        positionFilters,
        leaderFilters,
        selectedPosition,
        selectedLeader,
        statusLabel,
        isEmployees
    };
}

function buildEmployeesListHTML(selectedEmployeeId = null) {
    const state = getState();
    selectedEmployeeId ??= state.selectedPersonnelEmployeeId;
    const subTab = state.employeeViewMode || 'employees';
    const isEmployees = subTab === 'employees';
    const isLeaders = subTab === 'leaders';
    if (!isEmployees && !isLeaders) return '';

    const { filteredItems, statusFilter } = getFilteredEmployeesOrLeaders();

    if (filteredItems.length === 0) {
        const noun = isEmployees ? 'empleados' : 'líderes';
        const statusSuffix = statusFilter === 'active' ? 'activos' : statusFilter === 'inactive' ? 'inactivos' : '';
        return EmptyState.render({
            icon: isEmployees ? 'personnel' : 'key',
            title: `No hay ${noun} ${statusSuffix}`.trim(),
            description: 'Ajusta los filtros o agrega un nuevo registro.',
            size: 'large'
        });
    }

    return filteredItems.map(item => isEmployees
        ? EmployeeCard(item, {
            selected: item.id === selectedEmployeeId || item.key === selectedEmployeeId
        })
        : LeaderCard(item)).join('');
}

// ──────────────────────────────────────────────────────────────────────
// Card templates extracted to sibling files in Sprint 7. Re-exported here
// so external callers (app.js, modals, tests) keep their imports working.
// ──────────────────────────────────────────────────────────────────────
export { EmployeeCard } from './EmployeesList.js';
export { LeaderCard } from './LeadersList.js';
export { PositionCard } from './PositionsList.js';

// ============================================
// WINDOW FUNCTIONS (GLOBAL ACCESS)
// ============================================

// ============================================
// HANDLERS — moved to sibling sub-modules in Sprint 7b
// Re-exported so window.* assignments in app.js still resolve.
// ============================================

export {
    changeEmployeeViewMode,
    setEmployeeStatusFilter,
    setEmployeeSearchFilter,
    setEmployeePositionFilter,
    setEmployeeLeaderFilter,
    toggleEmployeePositionFilter,
    toggleEmployeeLeaderFilter,
    filterEmployeeFilterOptions,
    setEmployeeFilterMenuOpen,
    resetEmployeeFilters,
    openEmployeeForm,
    openEmployeeEditor,
    setEmployeeSalaryView,
    toggleEmployeeStatus,
    deleteEmployeeHandler
} from './EmployeesList.js';

export {
    openLeaderForm,
    setLeaderSortBy,
    toggleLeaderEmployees,
    toggleLeaderStatus
} from './LeadersList.js';

export {
    togglePositionEmployees,
    setPositionStatusFilter,
    setPositionSearchFilter,
    setPositionLeaderFilter,
    setPositionSortBy,
    openPositionForm,
    togglePositionStatus,
    cleanupPositionReferences,
    deletePosition,
    savePosition
} from './PositionsList.js';

export function openEmployeeFloating(empId) {
    EmployeeFloatingCard.open(empId);
}

export function closeFloatingCard() {
    EmployeeFloatingCard.close();
}

export function changeFloatingMonth(delta) {
    EmployeeFloatingCard.changeMonth(delta);
}

export function changeProfileAsistenciaMonth(delta) {
    const state = getState();
    stateManager.batchSetState(() => {
        if (!state.employeeProfile.assistanceMonth) state.employeeProfile.assistanceMonth = new Date();
        state.employeeProfile.assistanceMonth.setMonth(state.employeeProfile.assistanceMonth.getMonth() + delta);
        state.employeeProfile.assistanceMonth = new Date(state.employeeProfile.assistanceMonth);
    });
}

export function changeProfileStartMonth(delta) {
    const state = getState();
    stateManager.batchSetState(() => {
        if (!state.employeeProfile.startPickerMonth) state.employeeProfile.startPickerMonth = new Date();
        state.employeeProfile.startPickerMonth.setMonth(state.employeeProfile.startPickerMonth.getMonth() + delta);
        state.employeeProfile.startPickerMonth = new Date(state.employeeProfile.startPickerMonth);
    });
}

export function changeProfileEndMonth(delta) {
    const state = getState();
    stateManager.batchSetState(() => {
        if (!state.employeeProfile.endPickerMonth) state.employeeProfile.endPickerMonth = new Date();
        state.employeeProfile.endPickerMonth.setMonth(state.employeeProfile.endPickerMonth.getMonth() + delta);
        state.employeeProfile.endPickerMonth = new Date(state.employeeProfile.endPickerMonth);
    });
}

export function openEmployeeProfile(employeeId) {
    const state = getState();
    const employee = state.employees.find(e => e.id === employeeId || e.key === employeeId);
    if (!employee) return;
    stateManager.batchSetState(() => {
        state.selectedEmployee = employee;

        state.employeeProfile = {
            employeeId: employee.id,
            activeTab: 'resumen', // Empezar en resumen es más natural
            periodStart: state.exportConfig?.periodStart || getDateKey(new Date(Date.now() - 14 * 86400000)),
            periodEnd: state.exportConfig?.periodEnd || getDateKey(new Date()),
            assistanceMonth: new Date(),
            startPickerMonth: new Date(),
            endPickerMonth: new Date(),
            showStartPicker: false,
            showEndPicker: false,
            showPositionBreakdown: true,
            // Cargar datos persistidos
            advances: Array.isArray(employee?.advances) ? JSON.parse(JSON.stringify(employee.advances)) : [],
            bonuses: Array.isArray(employee?.bonuses) ? JSON.parse(JSON.stringify(employee.bonuses)) : [],
            deductions: Array.isArray(employee?.deductions) ? JSON.parse(JSON.stringify(employee.deductions)) : []
        };

        state.showEmployeeProfile = true;
    });
}

