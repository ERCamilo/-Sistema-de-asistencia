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
    resetEmployeeFilters,
    openEmployeeForm,
    toggleEmployeeStatus
} from './EmployeesList.js';

export {
    openLeaderForm,
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

