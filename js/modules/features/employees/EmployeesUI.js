import icons from '../../ui/IconSystem.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { slugify } from '../../utils/Helpers.js';
import { Modal } from '../../components/Modal.js';
import { EmptyState } from '../../components/EmptyState.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { EmployeeModal } from '../../ui/modals/EmployeeModal.js';
import { LeaderModal } from '../../ui/modals/LeaderModal.js';
import { PositionModal } from '../../ui/modals/PositionModal.js';
import { EmployeeFloatingCard } from '../../ui/components/EmployeeFloatingCard.js';
import { state as _appState } from '../../core/AppState.js';

export let context = null;

// Mapa de acciones para event delegation (data-action)
// Las funciones se resuelven en runtime contra window.* para mantener compat con código legacy.
// Los handlers reciben (arg, targetEl, event) para soportar acciones con DOM closures.
const _ACTION_MAP = {
    'open-employee-profile': (id) => window.openEmployeeProfile?.(id),
    'open-employee-form': (id) => window.openEmployeeForm?.(id || undefined),
    'open-employee-floating': (id) => window.openEmployeeFloating?.(id),
    'toggle-employee-status': (id) => window.toggleEmployeeStatus?.(id),
    'open-leader-form': (id) => window.openLeaderForm?.(id || undefined),
    'toggle-leader-status': (id) => window.toggleLeaderStatus?.(id),
    'toggle-leader-employees': (id) => window.toggleLeaderEmployees?.(id),
    'open-position-form': (id) => window.openPositionForm?.(id || undefined),
    'toggle-position-status': (id) => window.togglePositionStatus?.(id),
    'toggle-position-employees': (id) => window.togglePositionEmployees?.(id),
    'delete-position': (id) => window.deletePosition?.(id),
    'reset-employee-filters': () => window.resetEmployeeFilters?.(),
    'change-view-mode': (mode) => window.changeEmployeeViewMode?.(mode),
    'set-position-sort-by': (mode) => window.setPositionSortBy?.(mode),
    'set-employee-status-filter': (status) => window.setEmployeeStatusFilter?.(status),
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

function _handleDelegatedClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const handler = _ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id || target.dataset.value || null;
    handler(arg, target, e);
}

// Soporte de teclado para role="button" con data-action (Enter/Space)
function _handleDelegatedKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-action]');
    if (!target || target.tagName === 'BUTTON' || target.tagName === 'A') return;
    if (target.getAttribute('role') !== 'button') return;
    e.preventDefault();
    _handleDelegatedClick(e);
}

let _delegationAttached = false;

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

// ============================================
// EMPLOYEES TAB
// ============================================


export function EmployeesTab() {
    const state = getState();
    // Nuevo: agregar subtab de posiciones
    const subTab = state.employeeViewMode || 'employees'; // 'employees', 'leaders', 'positions'
    const isEmployees = subTab === 'employees';
    const isLeaders = subTab === 'leaders';
    const isPositions = subTab === 'positions';

    // Renderizar sub-tabs siempre
    const subTabsHTML = `
                <div class="date-controls">
                    <div class="view-controls">
                        <button class="view-btn ${isEmployees ? 'active' : ''}"
                                type="button"
                                data-action="change-view-mode" data-value="employees"
                                aria-label="Ver empleados">
                            ${icons.get('personnel')} Empleados
                        </button>
                        <button class="view-btn ${isLeaders ? 'active' : ''}"
                                type="button"
                                data-action="change-view-mode" data-value="leaders"
                                aria-label="Ver líderes">
                            ${icons.get('key')} Líderes
                        </button>
                        <button class="view-btn ${isPositions ? 'active' : ''}"
                                type="button"
                                data-action="change-view-mode" data-value="positions"
                                aria-label="Ver posiciones">
                            ${icons.get('briefcase')} Puestos
                        </button>
                    </div>
                </div>
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
        const sortBy = state.positionSortBy;

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

        filteredPositions.sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'salary') return (b.salaryConfig?.amount || 0) - (a.salaryConfig?.amount || 0);
            return 0;
        });

        return `
                    ${subTabsHTML}
                    <div class="date-controls" style="margin-bottom: 16px;">
                        <div class="search-container filters-bar" style="margin-bottom: 12px;">
                            <div class="employee-search${positionFilters.search ? ' open' : ''}">
                                <button class="employee-search-btn"
                                        type="button"
                                        data-action="open-search" type="button"
                                        aria-label="Buscar">
                                    ${icons.get('search')}
                                </button>
                                <input type="text"
                                       value="${positionFilters.search || ''}"
                                       oninput="setPositionSearchFilter(this.value)"
                                       onfocus="this.closest('.employee-search').classList.add('open')"
                                       onblur="if(!this.value){this.closest('.employee-search').classList.remove('open')}"
                                       placeholder="Buscar posición o líder..."
                                       class="employee-search-input">
                                ${positionFilters.search ? `
                                    <button type="button" data-action="clear-search-position"
                                            class="employee-search-clear"
                                            aria-label="Limpiar búsqueda">
                                        ${icons.get('close')}
                                    </button>
                                ` : ''}
                            </div>

                            <div class="filter-pill ${positionFilters.leaderId !== 'all' ? 'active take-row' : ''}">
                                <button class="filter-pill-btn" type="button" data-action="open-filter-pill">
                                    ${icons.get('key')}
                                </button>
                                <span class="filter-pill-label">
                                    ${selectedLeader ? `Lider: ${selectedLeader.name}` : 'Lider: Todos'}
                                </span>
                                <select class="filter-pill-select"
                                        onchange="setPositionLeaderFilter(this.value)"
                                        onfocus="this.closest('.filter-pill').classList.add('open')"
                                        onblur="this.closest('.filter-pill').classList.remove('open')">
                                    <option value="all" ${(positionFilters.leaderId || 'all') === 'all' ? 'selected' : ''}>Todos los lideres</option>
                                    ${state.leaders.map(l => `
                                        <option value="${l.id}" ${positionFilters.leaderId === l.id ? 'selected' : ''}>
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
                                        onchange="setPositionStatusFilter(this.value)"
                                        onfocus="this.closest('.filter-pill').classList.add('open')"
                                        onblur="this.closest('.filter-pill').classList.remove('open')">
                                    <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Activas</option>
                                    <option value="inactive" ${statusFilter === 'inactive' ? 'selected' : ''}>Inactivas</option>
                                    <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>Todas</option>
                                </select>
                            </div>
                        </div>

                        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                            <button class="view-btn ${sortBy === 'name' ? 'active' : ''}" type="button" data-action="set-position-sort-by" data-value="name" style="flex: 1;">
                                ${icons.get('search')} Por Nombre
                            </button>
                            <button class="view-btn ${sortBy === 'salary' ? 'active' : ''}" type="button" data-action="set-position-sort-by" data-value="salary" style="flex: 1;">
                                ${icons.get('payroll')} Por Sueldo
                            </button>
                        </div>
                        
                        <button class="view-btn" type="button" data-action="open-position-form" style="width: 100%; background: #06b6d4; color: #000; border-color: #06b6d4;">
                            ${icons.get('add')} Nueva Posicion
                        </button>
                    </div>
                    
                    ${filteredPositions.length === 0 ? EmptyState.render({
                        icon: 'briefcase',
                        title: `No hay posiciones ${statusFilter === 'active' ? 'activas' : statusFilter === 'inactive' ? 'inactivas' : ''}`.trim(),
                        description: statusFilter === 'active' ? 'Crea una posición o cambia el filtro para ver otras.' : 'Cambia el filtro para ver las posiciones disponibles.',
                        size: 'large'
                    }) : filteredPositions.map(PositionCard).join('')}
                `;
    }

    // Si es empleados o líderes — usar lógica compartida
    const { filteredItems, statusFilter, positionFilter, leaderFilter, selectedPosition, selectedLeader, statusLabel } = getFilteredEmployeesOrLeaders();
    const employeeFilters = state.employeeFilters || { search: '', positionId: 'all', leaderId: 'all', status: 'active' };

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
                        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
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
                    `}

                    <button class="view-btn" type="button" data-action="${isEmployees ? 'open-employee-form' : 'open-leader-form'}" style="width: 100%; margin-top: 12px; background: #06b6d4; color: #000; border-color: #06b6d4;">
                        ${icons.get('add')} Nuevo ${isEmployees ? 'Empleado' : 'Lider'}
                    </button>
                </div>
                
                <div id="employees-list" data-preserve-scroll="employees-list">
                    ${buildEmployeesListHTML()}
                </div>
            `;
}

// ============================================
// SHARED FILTER LOGIC (eliminates duplication between EmployeesTab and buildEmployeesListHTML)
// ============================================

function getFilteredEmployeesOrLeaders() {
    const state = getState();
    const subTab = state.employeeViewMode || 'employees';
    const isEmployees = subTab === 'employees';

    const items = isEmployees ? state.employees : state.leaders;
    const employeeFilters = state.employeeFilters || {
        search: '',
        positionId: 'all',
        leaderId: 'all',
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
    let selectedPosition = null;
    let selectedLeader = null;
    let statusLabel = 'Activos';

    if (isEmployees) {
        positionFilter = employeeFilters.positionId || 'all';
        leaderFilter = employeeFilters.leaderId || 'all';
        const searchValue = (employeeFilters.search || '').trim().toLowerCase();
        selectedPosition = positionFilter !== 'all' ? state.positions.find(p => p.id === positionFilter) : null;
        selectedLeader = leaderFilter !== 'all' ? state.leaders.find(l => l.id === leaderFilter) : null;
        statusLabel = statusFilter === 'inactive' ? 'Desactivados' : (statusFilter === 'all' ? 'Todos' : 'Activos');

        if (positionFilter !== 'all') {
            filteredItems = filteredItems.filter(emp => (emp.positions || []).includes(positionFilter));
        }
        if (leaderFilter !== 'all') {
            const leaderPositions = state.positions
                .filter(p => p.leaderId === leaderFilter)
                .map(p => p.id);
            filteredItems = filteredItems.filter(emp => (emp.positions || []).some(pid => leaderPositions.includes(pid)));
        }
        if (searchValue) {
            filteredItems = filteredItems.filter(emp => {
                const nameMatch = (emp.name || '').toLowerCase().includes(searchValue);
                const numberMatch = (emp.number || '').toLowerCase().includes(searchValue);
                const positionMatch = (emp.positions || []).some(pid => {
                    const pos = state.positions.find(p => p.id === pid);
                    return pos && pos.name && pos.name.toLowerCase().includes(searchValue);
                });
                return nameMatch || numberMatch || positionMatch;
            });
        }
    }

    filteredItems.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (isEmployees) {
            const aNum = parseInt(a.number, 10);
            const bNum = parseInt(b.number, 10);
            if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
            return String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true });
        }
        return (a.name || '').localeCompare(b.name || '');
    });

    return { filteredItems, statusFilter, positionFilter, leaderFilter, selectedPosition, selectedLeader, statusLabel, isEmployees };
}

function buildEmployeesListHTML() {
    const state = getState();
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

    return filteredItems.map(item => isEmployees ? EmployeeCard(item) : LeaderCard(item)).join('');
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

export function changeEmployeeViewMode(mode) {
    const state = getState();
    state.employeeViewMode = mode;
    context.render();
}

export function setEmployeeStatusFilter(filter) {
    const state = getState();
    state.employeeStatusFilter = filter;
    if (!state.employeeFilters) {
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
    }
    state.employeeFilters.status = filter;
    context.render();
}

export function setEmployeeSearchFilter(value) {
    const state = getState();
    if (!state.employeeFilters) {
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
    }
    state.employeeFilters.search = value;
    const input = document.querySelector('.employee-search-input');
    const keepFocus = input && document.activeElement === input;
    const cursorPos = keepFocus ? input.selectionStart : null;

    const list = document.getElementById('employees-list');
    if (list && (state.employeeViewMode || 'employees') === 'employees') {
        list.innerHTML = buildEmployeesListHTML();
        if (keepFocus) {
            requestAnimationFrame(() => {
                const refocus = document.querySelector('.employee-search-input');
                if (refocus) {
                    refocus.focus();
                    const pos = cursorPos !== null ? cursorPos : refocus.value.length;
                    refocus.setSelectionRange(pos, pos);
                }
            });
        }
        return;
    }
    context.render();
}

export function setEmployeePositionFilter(positionId) {
    const state = getState();
    if (!state.employeeFilters) {
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
    }
    state.employeeFilters.positionId = positionId;
    context.render();
}

export function setEmployeeLeaderFilter(leaderId) {
    const state = getState();
    if (!state.employeeFilters) {
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
    }
    state.employeeFilters.leaderId = leaderId;
    context.render();
}

export function resetEmployeeFilters() {
    const state = getState();
    state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
    state.employeeStatusFilter = 'active';
    context.render();
}

export function openEmployeeForm(employeeId = null) {
    EmployeeModal.open(employeeId);
}

export function openLeaderForm(leaderId = null) {
    LeaderModal.open(leaderId);
}

export function togglePositionEmployees(positionId) {
    const elem = document.getElementById(`pos-employees-${positionId}`);
    if (elem) {
        elem.style.display = elem.style.display === 'none' ? 'block' : 'none';
    }
}

export function toggleLeaderEmployees(leaderId) {
    const elem = document.getElementById(`leader-employees-${leaderId}`);
    if (elem) {
        elem.style.display = elem.style.display === 'none' ? 'block' : 'none';
    }
}

export function toggleEmployeeStatus(employeeId) {
    const state = getState();
    const emp = state.employees.find(e => e.key === employeeId || e.id === employeeId);
    if (emp) {
        const action = emp.active ? 'desactivar' : 'activar';
        const actionPast = emp.active ? 'desactivado' : 'activado';

        Modal.confirm({
            title: emp.active ? `${icons.get('x-circle')} Desactivar Empleado` : `${icons.get('info')} Activar Empleado`,
            message: `¿Estás seguro de ${action} a ${emp.name}?`,
            confirmText: action === 'desactivar' ? 'Sí, desactivar' : 'Sí, activar',
            cancelText: 'Cancelar',
            type: emp.active ? 'warning' : 'info',
            onConfirm: () => {
                emp.active = !emp.active;
                const changeDate = getDateKey(new Date());
                emp.lastStatusChange = changeDate;
                emp.updatedAt = Date.now();
                emp._isDirty = true;

                // Mantener historial de cambios de estado
                if (!emp.statusHistory) {
                    emp.statusHistory = [];
                }
                emp.statusHistory.push({
                    date: changeDate,
                    active: emp.active,
                    timestamp: new Date().getTime()
                });

                context.saveToLocalStorage();
                window.showAlert(`${icons.get('info')} Empleado ${emp.name} ${actionPast} correctamente`, 'success');
                context.render();
            }
        });
    }
}

export function toggleLeaderStatus(leaderId) {
    const state = getState();
    const ldr = state.leaders.find(l => l.id === leaderId);
    if (ldr) {
        const action = ldr.active ? 'desactivar' : 'activar';
        const actionPast = ldr.active ? 'desactivado' : 'activado';

        Modal.confirm({
            title: ldr.active ? `${icons.get('x-circle')} Desactivar Lider` : `${icons.get('info')} Activar Lider`,
            message: `¿Estás seguro de ${action} al líder ${ldr.name}?`,
            confirmText: action === 'desactivar' ? 'Sí, desactivar' : 'Sí, activar',
            cancelText: 'Cancelar',
            type: ldr.active ? 'warning' : 'info',
            onConfirm: () => {
                ldr.active = !ldr.active;
                ldr.updatedAt = Date.now();
                ldr._isDirty = true;
                const changeDate = getDateKey(new Date());
                ldr.lastStatusChange = changeDate;
                ldr.updatedAt = Date.now();

                // Mantener historial de cambios de estado
                if (!ldr.statusHistory) {
                    ldr.statusHistory = [];
                }
                ldr.statusHistory.push({
                    date: changeDate,
                    active: ldr.active,
                    timestamp: new Date().getTime()
                });

                context.saveToLocalStorage();
                window.showAlert(`${icons.get('zap')} Líder ${ldr.name} ${actionPast} correctamente`, 'success');
                context.render();
            }
        });
    }
}

export function setPositionStatusFilter(filter) {
    const state = getState();
    state.positionStatusFilter = filter;
    if (!state.positionFilters) {
        state.positionFilters = { search: '', leaderId: 'all', status: 'active' };
    }
    state.positionFilters.status = filter;
    context.render();
}

export function setPositionSearchFilter(value) {
    const state = getState();
    if (!state.positionFilters) {
        state.positionFilters = { search: '', leaderId: 'all', status: 'active' };
    }
    state.positionFilters.search = value;
    context.render();
}

export function setPositionLeaderFilter(leaderId) {
    const state = getState();
    if (!state.positionFilters) {
        state.positionFilters = { search: '', leaderId: 'all', status: 'active' };
    }
    state.positionFilters.leaderId = leaderId;
    context.render();
}

export function setPositionSortBy(sortBy) {
    const state = getState();
    state.positionSortBy = sortBy;
    context.render();
}

export function openPositionForm(positionId = null) {
    PositionModal.open(positionId);
}

function handlePositionSubmit(formData) {
    const state = getState();
    const { posName: name, posHourlyRate: hourlyRate, posLeader: leaderId, posColor: color, workingDay: workingDays } = formData;

    if (!name) {
        window.showAlert('El nombre de la posición es obligatorio', 'error');
        return;
    }

    const rate = parseFloat(hourlyRate);
    if (isNaN(rate) || rate < 0) {
        window.showAlert('La tarifa por hora debe ser un número válido >= 0', 'error');
        return;
    }

    let finalName = name.trim();
    const newId = slugify(finalName);

    // Verificar nombre único
    if (state.editingPosition) {
        const existing = state.positions.find(p => p.id === newId && p.id !== state.editingPosition.id);
        if (existing) {
            window.showAlert('Ya existe una posición con ese nombre', 'error');
            return;
        }
    }

    if (state.editingPosition) {
        const oldId = state.editingPosition.id;
        const pos = state.positions.find(p => p.id === oldId);
        if (pos) {
            const idChanged = oldId !== newId;

            pos.id = newId;
            pos.name = finalName;
            pos.hourlyRate = rate;
            pos.leaderId = leaderId || null;
            pos.color = color;
            pos.workingDays = workingDays.map(d => parseInt(d));
            pos.updatedAt = Date.now();
            pos._isDirty = true;

            if (idChanged) {
                // Actualizar Referencias
                state.employees.forEach(emp => {
                    if (emp.positions) emp.positions = emp.positions.map(pid => pid === oldId ? newId : pid);
                    if (emp.positionSalaries && emp.positionSalaries[oldId] !== undefined) {
                        emp.positionSalaries[newId] = emp.positionSalaries[oldId];
                        delete emp.positionSalaries[oldId];
                    }
                });
                Object.values(state.attendance).forEach(att => {
                    if (att.positionHours) att.positionHours.forEach(ph => { if (ph.positionId === oldId) ph.positionId = newId; });
                    if (att.selectedPosition === oldId) att.selectedPosition = newId;
                });
            }

            window.showAlert(`${icons.get('check-circle')} Posición "${finalName}" actualizada`, 'success');
        }
    } else {
        state.positions.push({
            id: newId,
            name: finalName,
            hourlyRate: rate,
            workingDays: workingDays.map(d => parseInt(d)),
            leaderId: leaderId || null,
            color: color,
            active: true,
            updatedAt: Date.now(),
            _isDirty: true
        });
        window.showAlert(`${icons.get('check-circle')} Posición "${finalName}" creada correctamente`, 'success');
    }

    state.editingPosition = null;
    context.saveToLocalStorage();
    context.closeModal();
    context.render();
}

export function togglePositionStatus(positionId) {
    const state = getState();
    const pos = state.positions.find(p => p.id === positionId);
    if (!pos) return;

    const action = pos.active ? 'desactivar' : 'activar';
    Modal.confirm({
        title: pos.active ? `${icons.get('x-circle')} Desactivar Posición` : `${icons.get('info')} Activar Posición`,
        message: `¿Estás seguro de ${action} la posición "${pos.name}"?`,
        confirmText: pos.active ? 'Sí, desactivar' : 'Sí, activar',
        cancelText: 'Cancelar',
        type: pos.active ? 'warning' : 'info',
        onConfirm: () => {
            pos.active = !pos.active;
            pos.updatedAt = Date.now();
            pos._isDirty = true;
            context.saveToLocalStorage();
            context.render();
        }
    });
}

/**
 * 🛡️ Limpia todas las referencias a una posición del state.
 * Evita generar huérfanas en asistencias históricas y en empleados.
 *
 * Llamarla SIEMPRE antes de eliminar definitivamente una posición.
 *
 * @param {string} positionId — ID de la posición a limpiar
 * @returns {number} cantidad de referencias limpiadas (para tests/logging)
 */
export function cleanupPositionReferences(positionId) {
    const state = getState();
    let cleaned = 0;

    // 1. Limpiar en empleados (positions array + positionSalaries map)
    state.employees.forEach(emp => {
        if (emp.positions && emp.positions.includes(positionId)) {
            emp.positions = emp.positions.filter(pid => pid !== positionId);
            cleaned++;
        }
        if (emp.positionSalaries && emp.positionSalaries[positionId] !== undefined) {
            delete emp.positionSalaries[positionId];
            cleaned++;
        }
    });

    // 2. Limpiar en asistencias históricas
    Object.values(state.attendance || {}).forEach(att => {
        if (att.selectedPosition === positionId) {
            att.selectedPosition = null;
            cleaned++;
        }
        if (att.positionHours && att.positionHours.length > 0) {
            const filtered = att.positionHours.filter(ph => ph.positionId !== positionId);
            if (filtered.length !== att.positionHours.length) {
                att.positionHours = filtered;
                cleaned++;
            }
        }
    });

    return cleaned;
}

export function deletePosition(positionId) {
    const state = getState();
    const pos = state.positions.find(p => p.id === positionId);
    if (!pos) return;

    if (pos.active) {
        Modal.confirm({
            title: `${icons.get('alert')} No se puede eliminar`,
            message: `La posición "${pos.name}" está activa. Desactívala primero para poder eliminarla.`,
            confirmText: 'Aceptar',
            cancelText: 'Cerrar',
            type: 'warning',
            onConfirm: () => { }
        });
        return;
    }

    const hasAssigned = state.employees.some(e => (e.positions || []).includes(pos.id));
    if (hasAssigned) {
        Modal.confirm({
            title: `${icons.get('alert')} No se puede eliminar`,
            message: `La posición "${pos.name}" tiene empleados asignados.`,
            confirmText: 'Aceptar',
            cancelText: 'Cerrar',
            type: 'warning',
            onConfirm: () => { }
        });
        return;
    }

    Modal.confirm({
        title: `${icons.get('delete')} Eliminar Posición`,
        message: `¿Seguro que deseas eliminar la posición "${pos.name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Sí, eliminar',
        cancelText: 'Cancelar',
        type: 'danger',
        onConfirm: () => {
            // 🛡️ Limpiar referencias en asistencias históricas ANTES de eliminar
            // (previene huérfanas detectadas por validateDataIntegrity)
            const cleaned = cleanupPositionReferences(pos.id);
            if (cleaned > 0 && window.debug) {
                window.debug.log(`🛡️ Limpiadas ${cleaned} referencia(s) histórica(s) de "${pos.name}" antes de eliminar`);
            }

            state.positions = state.positions.filter(p => p.id !== pos.id);
            context.saveToLocalStorage();
            context.render();
        }
    });
}

// Deprecated
export function savePosition() {
    console.warn('savePosition is deprecated. Use handlePositionSubmit via FormComponent.');
}

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
    if (!state.employeeProfile.assistanceMonth) state.employeeProfile.assistanceMonth = new Date();
    state.employeeProfile.assistanceMonth.setMonth(state.employeeProfile.assistanceMonth.getMonth() + delta);
    state.employeeProfile.assistanceMonth = new Date(state.employeeProfile.assistanceMonth);
    context.render();
}

export function changeProfileStartMonth(delta) {
    const state = getState();
    if (!state.employeeProfile.startPickerMonth) state.employeeProfile.startPickerMonth = new Date();
    state.employeeProfile.startPickerMonth.setMonth(state.employeeProfile.startPickerMonth.getMonth() + delta);
    state.employeeProfile.startPickerMonth = new Date(state.employeeProfile.startPickerMonth);
    context.render();
}

export function changeProfileEndMonth(delta) {
    const state = getState();
    if (!state.employeeProfile.endPickerMonth) state.employeeProfile.endPickerMonth = new Date();
    state.employeeProfile.endPickerMonth.setMonth(state.employeeProfile.endPickerMonth.getMonth() + delta);
    state.employeeProfile.endPickerMonth = new Date(state.employeeProfile.endPickerMonth);
    context.render();
}

export function openEmployeeProfile(employeeId) {
    const state = getState();
    const employee = state.employees.find(e => e.id === employeeId);
    state.selectedEmployee = employee;

    state.employeeProfile = {
        employeeId,
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
    if (context && context.render) {
        context.render();
    }
}

