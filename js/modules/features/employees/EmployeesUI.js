import { icons } from '../../ui/IconSystem.js';

import { Modal } from '../../components/Modal.js';
import { getDateKey } from '../../utils/DateUtils.js';

let context = null;

export function init(ctx) {
    context = ctx;
}

// Helper to access state easier
function getState() {
    return context.state;
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
                <div class="date-controls" style="margin-bottom: 16px;">
                    <div class="view-controls" style="grid-template-columns: 1fr 1fr 1fr;">
                        <button class="view-btn ${isEmployees ? 'active' : ''}" 
                                onclick="changeEmployeeViewMode('employees')"
                                title="Ver empleados">
                            ${icons.get('personnel')} Empleados
                        </button>
                        <button class="view-btn ${isLeaders ? 'active' : ''}" 
                                onclick="changeEmployeeViewMode('leaders')"
                                title="Ver líderes">
                            ${icons.get('key')} Líderes
                        </button>
                        <button class="view-btn ${isPositions ? 'active' : ''}" 
                                onclick="changeEmployeeViewMode('positions')"
                                title="Ver posiciones">
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
                                        onclick="const w=this.closest('.employee-search'); w.classList.add('open'); const i=w.querySelector('input'); if(i) i.focus();"
                                        title="Buscar">
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
                                    <button onclick="setPositionSearchFilter(''); const w=this.closest('.employee-search'); w.classList.remove('open');"
                                            class="employee-search-clear"
                                            title="Limpiar búsqueda">
                                        ${icons.get('close')}
                                    </button>
                                ` : ''}
                            </div>

                            <div class="filter-pill ${positionFilters.leaderId !== 'all' ? 'active take-row' : ''}">
                                <button class="filter-pill-btn" type="button" onclick="this.closest('.filter-pill').classList.add('open')">
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
                                <button class="filter-pill-btn" type="button" onclick="this.closest('.filter-pill').classList.add('open')">
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
                            <button class="view-btn ${sortBy === 'name' ? 'active' : ''}" onclick="setPositionSortBy('name')" style="flex: 1;">
                                ${icons.get('search')} Por Nombre
                            </button>
                            <button class="view-btn ${sortBy === 'salary' ? 'active' : ''}" onclick="setPositionSortBy('salary')" style="flex: 1;">
                                ${icons.get('payroll')} Por Sueldo
                            </button>
                        </div>
                        
                        <button class="view-btn" onclick="openPositionForm()" style="width: 100%; background: #06b6d4; color: #000; border-color: #06b6d4;">
                            ${icons.get('add')} Nueva Posicion
                        </button>
                    </div>
                    
                    ${filteredPositions.length === 0 ? `
                        <div style="text-align:center;padding:60px 20px;color:#64748b;">
                            <div style="font-size:4rem;margin-bottom:16px;opacity:0.3;">${icons.get('edit')}</div>
                            <div style="font-size:1.125rem;">No hay posiciones ${statusFilter === 'active' ? 'activas' : statusFilter === 'inactive' ? 'inactivas' : ''}</div>
                        </div>
                    ` : filteredPositions.map(PositionCard).join('')}
                `;
    }

    // Si es empleados o líderes
    const items = isEmployees ? state.employees : state.leaders;
    const employeeFilters = state.employeeFilters || {
        search: '',
        positionId: 'all',
        leaderId: 'all',
        status: state.employeeStatusFilter || 'active'
    };
    const statusFilter = employeeFilters.status || state.employeeStatusFilter || 'active';

    // Filtrar por estado activo/inactivo
    let filteredItems = items.filter(item => {
        if (statusFilter === 'active') return item.active;
        if (statusFilter === 'inactive') return !item.active;
        return true; // all
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

    // Ordenar: activos primero, luego inactivos
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

    return `
                ${subTabsHTML}
                <div class="date-controls" style="margin-bottom: 16px;">
                    ${isEmployees ? `
                        <div class="search-container" style="margin-bottom: 12px; display: flex; gap: 10px; width: 100%; flex-wrap: wrap;">
                            <div class="employee-search${employeeFilters.search ? ' open' : ''}">
                                <button class="employee-search-btn"
                                        type="button"
                                        onclick="const w=this.closest('.employee-search'); w.classList.add('open'); const i=w.querySelector('input'); if(i) i.focus();"
                                        title="Buscar">
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
                                    <button onclick="setEmployeeSearchFilter(''); const w=this.closest('.employee-search'); w.classList.remove('open');"
                                            class="employee-search-clear"
                                            title="Limpiar búsqueda">
                                        ${icons.get('close')}
                                    </button>
                                ` : ''}
                            </div>

                            <div class="filter-pill ${positionFilter !== 'all' ? 'active take-row' : ''}">
                                <button class="filter-pill-btn" type="button" onclick="this.closest('.filter-pill').classList.add('open')">
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
                                <button class="filter-pill-btn" type="button" onclick="this.closest('.filter-pill').classList.add('open')">
                                    ${icons.get('key')}
                                </button>
                                <span class="filter-pill-label">
                                    ${selectedLeader ? `Lider: ${selectedLeader.name}` : 'Lider: Todos'}
                                </span>
                                <select class="filter-pill-select"
                                        onchange="setEmployeeLeaderFilter(this.value)"
                                        onfocus="this.closest('.filter-pill').classList.add('open')"
                                        onblur="this.closest('.filter-pill').classList.remove('open')">
                                    <option value="all" ${(employeeFilters.leaderId || 'all') === 'all' ? 'selected' : ''}>Todos los lideres</option>
                                    ${state.leaders.map(l => `
                                        <option value="${l.id}" ${employeeFilters.leaderId === l.id ? 'selected' : ''}>
                                            ${l.name}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>

                            <div class="filter-pill ${statusFilter !== 'active' ? 'active take-row' : ''}">
                                <button class="filter-pill-btn" type="button" onclick="this.closest('.filter-pill').classList.add('open')">
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

                            <button class="view-btn" onclick="resetEmployeeFilters()" style="height: 40px; padding: 0 12px;" title="Reiniciar filtros">
                                ${icons.get('refresh')} Reiniciar
                            </button>
                        </div>
                    ` : `
                        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                            <button class="view-btn ${statusFilter === 'active' ? 'active' : ''}" onclick="setEmployeeStatusFilter('active')" style="flex: 1;">
                                Activos
                            </button>
                            <button class="view-btn ${statusFilter === 'inactive' ? 'active' : ''}" onclick="setEmployeeStatusFilter('inactive')" style="flex: 1;">
                                Inactivos
                            </button>
                            <button class="view-btn ${statusFilter === 'all' ? 'active' : ''}" onclick="setEmployeeStatusFilter('all')" style="flex: 1;">
                                Todos
                            </button>
                        </div>
                    `}

                    <button class="view-btn" onclick="${isEmployees ? 'openEmployeeForm()' : 'openLeaderForm()'}" style="width: 100%; margin-top: 12px; background: #06b6d4; color: #000; border-color: #06b6d4;">
                        ${icons.get('add')} Nuevo ${isEmployees ? 'Empleado' : 'Lider'}
                    </button>
                </div>
                
                <div id="employees-list">
                    ${buildEmployeesListHTML()}
                </div>
            `;
}

function buildEmployeesListHTML() {
    const state = getState();
    const subTab = state.employeeViewMode || 'employees';
    const isEmployees = subTab === 'employees';
    const isLeaders = subTab === 'leaders';
    if (!isEmployees && !isLeaders) return '';

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

    if (isEmployees) {
        const positionFilter = employeeFilters.positionId || 'all';
        const leaderFilter = employeeFilters.leaderId || 'all';
        const searchValue = (employeeFilters.search || '').trim().toLowerCase();

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
        if (isEmployees) {
            const aNum = parseInt(a.number, 10);
            const bNum = parseInt(b.number, 10);
            if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
            return String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true });
        }
        return (a.name || '').localeCompare(b.name || '');
    });

    if (filteredItems.length === 0) {
        return `
            <div style="text-align:center;padding:60px 20px;color:#64748b;">
                <div style="font-size:4rem;margin-bottom:16px;opacity:0.3;">${isEmployees ? `${icons.get('personnel')}` : `${icons.get('key')}`}</div>
                <div style="font-size:1.125rem;">No hay ${isEmployees ? 'empleados' : 'líderes'} ${statusFilter === 'active' ? 'activos' : statusFilter === 'inactive' ? 'inactivos' : ''}</div>
            </div>
        `;
    }

    return filteredItems.map(item => isEmployees ? EmployeeCard(item) : LeaderCard(item)).join('');
}

export function EmployeeCard(emp) {
    const state = getState();
    const { payroll } = getServices();

    const leaders = emp.positions.map(posId => {
        const pos = state.positions.find(p => p.id === posId);
        if (!pos || !pos.leaderId) return null;
        const ldr = state.leaders.find(l => l.id === pos.leaderId);
        return ldr ? ldr.number : null;
    }).filter(Boolean);

    const salaryConfig = payroll.getSalaryConfig(emp);
    const salaryDisplay = payroll.formatSalaryDisplay(salaryConfig);
    const salaryType = emp.salaryConfig?.type === 'custom' ? 'Personalizado' : 'Estándar';

    // Formatear fechas
    const createdDate = emp.createdDate ? new Date(emp.createdDate).toLocaleDateString('es-DO', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
    const lastChange = emp.lastStatusChange ? new Date(emp.lastStatusChange).toLocaleDateString('es-DO', { year: 'numeric', month: 'short', day: 'numeric' }) : null;

    // Badge de estado mejorado
    const statusBadge = emp.active
        ? '<span style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);"><span style="width: 6px; height: 6px; background: #fff; border-radius: 50%; animation: pulse 2s infinite;"></span>ACTIVO</span>'
        : '<span style="background: #475569; color: #cbd5e1; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><span style="width: 6px; height: 6px; background: #64748b; border-radius: 50%;"></span>INACTIVO</span>';

    return `
                <div class="employee-row" style="${!emp.active ? 'opacity: 0.6; border-color: #475569;' : ''}">
                    <div class="employee-info" style="flex: 1;">
                        <div class="employee-header">
                            <div class="employee-number">${emp.number}</div>
                            <div class="employee-name" onclick="openEmployeeFloating('${emp.key || emp.id}')" title="${emp.name}">${emp.name}</div>
                            ${statusBadge}
                        </div>
                        <div class="position-toggles">
                            ${emp.positions.map(posId => {
        const pos = state.positions.find(p => p.id === posId);
        return `<span class="position-toggle" style="opacity:0.8;cursor:default;border-color:${pos.color};"><span class="pos-dot" style="background:${pos.color};"></span>${pos.name}</span>`;
    }).join('')}
                        </div>
                        <div class="employee-meta">
                            <div class="employee-meta-item">${icons.get('zap')} ${salaryDisplay.full} <span style="color: #64748b;">(${salaryType})</span></div>
                            ${leaders.length > 0 ? `<div class="employee-meta-divider"></div><div class="employee-meta-item">${icons.get('key')} ${leaders.join(', ')}</div>` : ''}
                        </div>
                        <div class="employee-meta" style="margin-top: 4px; font-size: 0.7rem;">
                            <div class="employee-meta-item" style="color: #64748b;">${icons.get('clock')} Trabaja: ${salaryDisplay.workDays}</div>
                        </div>
                        <div class="employee-meta" style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #1e293b;">
                            <div class="employee-meta-item" style="font-size: 0.7rem; color: #64748b;">${icons.get('calendar')} Creado: ${createdDate}</div>
                            ${lastChange ? `<div class="employee-meta-divider"></div><div class="employee-meta-item" style="font-size: 0.7rem; color: #64748b;">${emp.active ? `${icons.get('info')} Activado` : `${icons.get('x-circle')} Desactivado`}: ${lastChange}</div>` : ''}
                        </div>

                        <!-- 📝 VISTA PREVIA DE NOTAS GENERALES -->
                        ${emp.notes && emp.notes.trim() ? `
                            <div class="employee-meta" style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" 
                                 title="${emp.notes.replace(/"/g, '&quot;')}">
                                <div class="employee-meta-item" style="color: #94a3b8; font-size: 0.75rem;">
                                    📝 ${emp.notes}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <button class="view-btn" onclick="openEmployeeProfile('${emp.key || emp.id}')" style="padding: 8px 16px; font-size: 0.875rem; background: linear-gradient(135deg, #06b6d4, #10b981); color: #000; font-weight: 700; border: none;" title="Ver perfil completo">${icons.get('user')}</button>
                        <button class="view-btn" onclick="openEmployeeForm('${emp.key || emp.id}')" style="padding: 8px 16px; font-size: 0.875rem;" title="Editar empleado">${icons.get('edit')}</button>
                        <button class="view-btn ${emp.active ? '' : 'active'}" onclick="toggleEmployeeStatus('${emp.key || emp.id}')" style="padding: 8px 16px; font-size: 0.875rem;" title="${emp.active ? 'Desactivar empleado' : 'Activar empleado'}">
                            ${emp.active ? `${icons.get('pause')}` : `${icons.get('play')}`}
                        </button>
                    </div>
                </div>
            `;
}

export function LeaderCard(ldr) {
    const state = getState();
    const positionsLedList = state.positions.filter(p => p.leaderId === ldr.id && p.active);
    const positionsLed = positionsLedList.length;
    const positionsSections = positionsLedList.map(pos => {
        const emps = state.employees
            .filter(e => e.active && (e.positions || []).includes(pos.id))
            .sort((a, b) => {
                const aNum = parseInt(a.number, 10);
                const bNum = parseInt(b.number, 10);
                if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
                return String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true });
            });
        if (emps.length === 0) return '';
        return `
            <div style="margin-top: 8px;">
                <div style="font-size: 0.75rem; font-weight: 700; color: #e2e8f0; margin-bottom: 4px;">${pos.name}</div>
                ${emps.map(emp => `
                    <div style="display:flex; gap:8px; color:#f1f5f9; font-size:0.8rem; padding:2px 0;">
                        <span style="min-width:28px; color:#94a3b8; font-weight:700;">${emp.number || ''}-</span>
                        <span>${emp.name}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }).join('');

    // Badge de estado mejorado
    const statusBadge = ldr.active
        ? '<span style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);"><span style="width: 6px; height: 6px; background: #fff; border-radius: 50%; animation: pulse 2s infinite;"></span>ACTIVO</span>'
        : '<span style="background: #475569; color: #cbd5e1; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><span style="width: 6px; height: 6px; background: #64748b; border-radius: 50%;"></span>INACTIVO</span>';

    return `
                <div class="employee-row" style="${!ldr.active ? 'opacity: 0.6; border-color: #475569;' : ''}">
                    <div class="employee-info" style="flex: 1;">
                        <div class="employee-header">
                            <div class="employee-number" style="background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #000;">${ldr.number}</div>
                            <div class="employee-name">${ldr.name}</div>
                            <span style="font-size: 1.25rem; margin-left: 8px;">${icons.get('key')}</span>
                            ${statusBadge}
                        </div>
                        <div class="employee-meta" style="margin-top: 8px;">
                              <div class="employee-meta-item">${icons.get('personnel')} Supervisa: ${positionsLed} posiciones</div>
                        </div>
                        ${positionsSections ? `
                            <div style="margin-top: 8px;">
                                <button class="view-btn" onclick="toggleLeaderEmployees('${ldr.id}')" style="padding: 6px 12px; font-size: 0.75rem; width: 100%;">
                                    ${icons.get('eye')} Ver Empleados
                                </button>
                                <div id="leader-employees-${ldr.id}" style="display: none; margin-top: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 8px;">
                                    ${positionsSections}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                         <button class="view-btn" onclick="openLeaderForm('${ldr.id}')" style="padding: 8px 16px; font-size: 0.875rem;" title="Editar lider">${icons.get('edit')}</button>
                         <button class="view-btn ${ldr.active ? '' : 'active'}" onclick="toggleLeaderStatus('${ldr.id}')" style="padding: 8px 16px; font-size: 0.875rem;" title="${ldr.active ? 'Desactivar líder' : 'Activar líder'}">
                            ${ldr.active ? `${icons.get('pause')}` : `${icons.get('play')}`}
                        </button>
                    </div>
                </div>
            `;
}

export function PositionCard(pos) {
    const state = getState();
    const ldr = pos.leaderId ? state.leaders.find(l => l.id === pos.leaderId) : null;
    const empCount = state.employees.filter(e => e.positions.includes(pos.id) && e.active).length;
    const totalAssigned = state.employees.filter(e => e.positions.includes(pos.id)).length;
    const canDelete = totalAssigned === 0 && !pos.active;
    const employeesInPosition = state.employees.filter(e => e.positions.includes(pos.id) && e.active);

    return `
                <div class="employee-row" style="border-left: 4px solid ${pos.color}; ${!pos.active ? 'opacity: 0.6; border-color: #475569;' : ''}">
                    <div class="employee-info" style="flex: 1;">
                        <div class="employee-header">
                            <div class="employee-name" style="color: ${pos.color};">${pos.name}</div>
                            ${!pos.active ? '<span style="background: #475569; color: #cbd5e1; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem;">INACTIVA</span>' : ''}
                        </div>
                        <div class="employee-meta">
                            <div class="employee-meta-item">${icons.get('payroll')} Tarifa: $${pos.hourlyRate}/hr</div>
                            <div class="employee-meta-divider"></div>
                             <div class="employee-meta-item">${icons.get('personnel')} ${empCount} empleados</div>
                            ${ldr ? `<div class="employee-meta-divider"></div><div class="employee-meta-item">${icons.get('key')} ${ldr.name}</div>` : ''}
                        </div>
                        <div class="employee-meta" style="margin-top: 4px; font-size: 0.7rem;">
                            <div class="employee-meta-item" style="color: #64748b;">
                                ${icons.get('calendar')} Dias: ${pos.workingDays && pos.workingDays.length > 0 ? pos.workingDays.map(d => ['D', 'L', 'M', 'X', 'J', 'V', 'S'][d]).join(', ') : 'Todos'}
                            </div>
                        </div>
                        ${employeesInPosition.length > 0 ? `
                            <div style="margin-top: 8px;">
                                <button class="view-btn" onclick="togglePositionEmployees('${pos.id}')" style="padding: 6px 12px; font-size: 0.75rem; width: 100%;">
                                    ${icons.get('eye')} Ver Empleados (${employeesInPosition.length})
                                </button>
                                <div id="pos-employees-${pos.id}" style="display: none; margin-top: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 8px;">
                                    ${employeesInPosition.map((emp, idx) => {
        const customRate = emp.positionSalaries && emp.positionSalaries[pos.id] !== undefined
            ? Number(emp.positionSalaries[pos.id])
            : null;
        const baseRate = Number(pos.hourlyRate);
        const showCustomRate = customRate !== null && !Number.isNaN(customRate) && (Number.isNaN(baseRate) || customRate !== baseRate);

        const deductions = Array.isArray(emp.deductions) ? emp.deductions : [];
        let deductionText = '';
        if (deductions.length > 0) {
            let fixedTotal = 0;
            let percentTotal = 0;
            let hasFixed = false;
            let hasPercent = false;
            deductions.forEach(d => {
                if (d.type === 'fixed') {
                    fixedTotal += Number(d.value) || 0;
                    hasFixed = true;
                } else {
                    percentTotal += Number(d.value) || 0;
                    hasPercent = true;
                }
            });
            if (hasFixed && hasPercent) {
                deductionText = `-$${fixedTotal.toLocaleString()} + ${percentTotal}%`;
            } else if (hasFixed) {
                deductionText = `-$${fixedTotal.toLocaleString()}`;
            } else if (hasPercent) {
                deductionText = `-${percentTotal}%`;
            }
        }

        return `
                                        <div style="padding: 4px 0; color: #f1f5f9; ${idx < employeesInPosition.length - 1 ? 'border-bottom: 1px solid #334155;' : ''}">
                                            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                                                <div style="min-width:40px; color:#94a3b8; font-weight:700;">${emp.number || ''}</div>
                                                <div style="flex:1;">${emp.name}</div>
                                                <div style="display:flex; align-items:center; gap:8px; justify-content:flex-end; min-width:140px;">
                                                    ${showCustomRate ? `<span style="color:#38bdf8; font-weight:700;">$${customRate}/hr</span>` : ''}
                                                    ${deductionText ? `<span style="color:#f87171; font-weight:700;">${deductionText}</span>` : ''}
                                                </div>
                                            </div>
                                        </div>
                                    `;
    }).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <button class="view-btn" onclick="openPositionForm('${pos.id}')" style="padding: 8px;" title="Editar posicion">${icons.get('edit')}</button>
                        <button class="view-btn ${pos.active ? '' : 'active'}" onclick="togglePositionStatus('${pos.id}')" style="padding: 8px;" title="${pos.active ? 'Desactivar posición' : 'Activar posición'}">
                            ${pos.active ? `${icons.get('pause')}` : `${icons.get('play')}`}
                        </button>
                        
                        ${pos.active ? "" :
                            `<button class="view-btn" onclick="${canDelete ? `deletePosition('${pos.id}')` : ''}" style="padding: 8px; ${canDelete ? '' : 'opacity: 0.4; cursor: allowed;'}" title="${canDelete ? 'Eliminar posición' : 'No se puede eliminar: hay empleados asignados o la posición está activa'}">
                            ${icons.get('delete')} 
                            </button>`}


                    </div>
                </div>
            `;
}

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
    const state = getState();
    state.editingEmployee = employeeId ? state.employees.find(e => e.key === employeeId || e.id === employeeId) : null;

    // ⚡ NUEVO: Cargar sueldos personalizados si existen
    if (state.editingEmployee && state.editingEmployee.positionSalaries) {
        state.tempPositionSalaries = { ...state.editingEmployee.positionSalaries };
    } else {
        state.tempPositionSalaries = {};
    }

    // ⚡ NUEVO: Inicializar date picker de fecha de contratación
    const hireDateValue = state.editingEmployee?.hireDate || new Date().toISOString().split('T')[0];
    state.hireDatePickerMonth = new Date(hireDateValue + 'T00:00:00');
    state.showHireDatePicker = false;

    state.modalType = 'employee-form';
    state.showModal = true;
    context.render();
}

export function openLeaderForm(leaderId = null) {
    const state = getState();
    state.editingLeader = leaderId ? state.leaders.find(l => l.id === leaderId) : null;
    state.modalType = 'leader-form';
    state.showModal = true;
    context.render();
}

export function saveEmployee() {
    const state = getState();
    // Limpiar errores previos
    state.formErrors = {};

    const name = document.getElementById('empName').value.trim();
    const number = document.getElementById('empNumber').value.trim();
    const positions = Array.from(document.querySelectorAll('input[name="empPosition"]:checked')).map(cb => cb.value);
    const phone = document.getElementById('empPhone')?.value.trim() || '';
    const email = document.getElementById('empEmail')?.value.trim() || '';
    const notes = document.getElementById('empNotes')?.value.trim() || '';
    const hireDate = document.getElementById('empHireDate')?.value;

    // ⚡ NUEVO: Obtener sueldos personalizados por posición
    const positionSalaries = state.tempPositionSalaries || {};

    // Validar campos
    let hasErrors = false;

    if (!name) {
        state.formErrors.empName = 'El nombre es obligatorio';
        hasErrors = true;
    }
    if (!number) {
        state.formErrors.empNumber = 'El número de empleado es obligatorio';
        hasErrors = true;
    } else if (!/^[0-9A-Za-z-]+$/.test(number)) {
        state.formErrors.empNumber = 'Solo puede contener números, letras y guiones';
        hasErrors = true;
    }
    if (positions.length === 0) {
        state.formErrors.empPosition = 'Debe seleccionar al menos una posición';
        hasErrors = true;
    }

    if (hasErrors) {
        context.render();
        return;
    }

    // Verificar si el número ya existe (excepto el empleado actual)
    const existingEmployee = state.employees.find(e =>
        e.number === number &&
        (!state.editingEmployee || e.key !== state.editingEmployee.key)
    );

    if (existingEmployee) {
        new Modal({
            title: `${icons.get('zap')} Número Duplicado`,
            content: `
                <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 20px;">
                    Ya existe un empleado con el número <strong>"${number}"</strong>: <br>
                    <span style="color: #f1f5f9; font-weight: 600;">${existingEmployee.name}</span>
                </p>
                <p style="color: #64748b; font-size: 0.875rem;">
                    ¿Qué deseas hacer? Si continúas, tendrás dos empleados con el mismo número hasta que lo corrijas.
                </p>
            `,
            size: 'medium',
            buttons: [
                {
                    text: 'Cancelar',
                    class: 'btn-secondary',
                    onClick: function() { this.close(); }
                },
                {
                    text: 'Sí, continuar',
                    class: 'btn-primary',
                    onClick: function() {
                        this.close();
                        saveEmployeeData(name, number, positions, phone, email, notes, hireDate, positionSalaries);
                    }
                },
                {
                    text: `Guardar y editar a ${existingEmployee.name.split(' ')[0]}`,
                    class: 'btn-primary',
                    style: 'background: linear-gradient(135deg, #06b6d4, #10b981); color: #000; border: none;',
                    onClick: function() {
                        this.close();
                        // Guardar el actual
                        saveEmployeeData(name, number, positions, phone, email, notes, hireDate, positionSalaries);
                        // Abrir el otro
                        setTimeout(() => {
                            openEmployeeForm(existingEmployee.key || existingEmployee.id);
                        }, 400);
                    }
                },
                {
                    text: `Intercambiar números`,
                    class: 'btn-primary',
                    style: 'background: linear-gradient(135deg, #a855f7, #ec4899); color: #fff; border: none;',
                    onClick: function() {
                        this.close();
                        const oldNumber = state.editingEmployee ? state.editingEmployee.number : null;
                        if (oldNumber) {
                            // Pedro (existing) toma el número viejo de Juan
                            existingEmployee.number = oldNumber;
                            // Juan (actual) toma el número nuevo (2)
                            saveEmployeeData(name, number, positions, phone, email, notes, hireDate, positionSalaries);
                            window.showAlert(`${icons.get('zap')} Números intercambiados entre ${name} y ${existingEmployee.name}`, 'success');
                        } else {
                            // Si es nuevo, simplemente guardamos ambos (aunque el actual sea el único con número nuevo)
                            saveEmployeeData(name, number, positions, phone, email, notes, hireDate, positionSalaries);
                        }
                    }
                }
            ]
        }).open();
        return;
    }

    saveEmployeeData(name, number, positions, phone, email, notes, hireDate, positionSalaries);
}

function saveEmployeeData(name, number, positions, phone, email, notes, hireDate, positionSalaries) {
    const state = getState();

    if (state.editingEmployee) {
        // Editar existente
        const emp = state.employees.find(e => e.key === state.editingEmployee.key);
        emp.name = name;
        emp.number = number;
        emp.positions = positions;
        emp.phone = phone;
        emp.email = email;
        emp.notes = notes;

        // 💡 Guardar fecha de contratación (siempre)
        emp.hireDate = hireDate || getDateKey(new Date());

        // ⚡ NUEVO: Guardar sueldos personalizados por posición
        emp.positionSalaries = {};
        positions.forEach(posId => {
            if (positionSalaries[posId]) {
                emp.positionSalaries[posId] = positionSalaries[posId];
            }
        });

        // Limpiar customSalary antiguo si existe
        if (emp.customSalary !== undefined) {
            delete emp.customSalary;
        }

        emp.updatedAt = Date.now();
        emp._isDirty = true;

        window.showAlert(`${icons.get('info')} Empleado ${name} actualizado correctamente`, 'success');
    } else {
        // Crear nuevo
        const newKey = `EMP${Date.now()}`;
        const today = getDateKey(new Date());

        // Usar fecha de contratación del input o hoy por defecto
        const finalHireDate = hireDate || today;

        // ⚡ NUEVO: Preparar sueldos por posición
        const finalPositionSalaries = {};
        positions.forEach(posId => {
            if (positionSalaries[posId]) {
                finalPositionSalaries[posId] = positionSalaries[posId];
            }
        });

        const newEmployee = {
            id: newKey,
            key: newKey,
            number: number,
            name: name,
            positions: positions,
            positionSalaries: finalPositionSalaries, // ${icons.get('info')} NUEVO
            active: true,
            createdDate: today,
            hireDate: finalHireDate,
            lastStatusChange: null,
            phone: phone,
            email: email,
            notes: notes,
            statusHistory: [
                {
                    date: finalHireDate,
                    active: true,
                    timestamp: new Date(finalHireDate).getTime()
                }
            ],
            updatedAt: Date.now(),
            _isDirty: true
        };

        state.employees.push(newEmployee);
        window.showAlert(`${icons.get('info')} Empleado ${name} creado correctamente`, 'success');
    }

    // Limpiar temporal
    state.tempPositionSalaries = {};

    context.saveToLocalStorage();
    context.closeModal();
    context.render(); // Ensure render is called to update UI
}

export function saveLeader() {
    const state = getState();
    const name = document.getElementById('ldrName').value.trim();
    const phone = document.getElementById('ldrPhone')?.value.trim() || '';
    const email = document.getElementById('ldrEmail')?.value.trim() || '';
    const notes = document.getElementById('ldrNotes')?.value.trim() || '';

    if (!name) {
        alert(`${icons.get('alert')} El nombre es obligatorio`);
        return;
    }

    if (state.editingLeader) {
        // Editar existente
        const ldr = state.leaders.find(l => l.id === state.editingLeader.id);
        ldr.name = name;
        ldr.phone = phone;
        ldr.email = email;
        ldr.notes = notes;
        ldr.updatedAt = Date.now();
        ldr._isDirty = true;
    } else {
        // Crear nuevo
        const maxNum = Math.max(0, ...state.leaders.map(l => parseInt(l.number.replace('L-', ''))));
        const newNum = `L-${String(maxNum + 1).padStart(3, '0')}`;
        state.leaders.push({
            id: `LDR${Date.now()}`,
            number: newNum,
            name: name,
            active: true,
            phone: phone,
            email: email,
            notes: notes,
            updatedAt: Date.now(),
            _isDirty: true
        });
    }

    context.saveToLocalStorage();
    context.closeModal();
    context.render();
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
    const state = getState();
    state.editingPosition = positionId ? state.positions.find(p => p.id === positionId) : null;
    state.modalType = 'position-form';
    state.showModal = true;
    context.render();
    if (window.initPositionModalListeners) window.initPositionModalListeners();
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

    const hasAssigned = state.employees.some(e => e.positions.includes(pos.id));
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
            state.positions = state.positions.filter(p => p.id !== pos.id);
            context.saveToLocalStorage();
            context.render();
        }
    });
}

export function savePosition() {
    const state = getState();
    const name = document.getElementById('posName').value.trim();
    const hourlyRate = Number.parseFloat(document.getElementById('posHourlyRate').value);
    const leaderId = document.getElementById('posLeader').value || null;
    const color = document.querySelector('input[name="posColor"]:checked')?.value || '#94a3b8';

    // 💡 Capturar días laborales seleccionados
    const workingDays = Array.from(document.querySelectorAll('input[name="workingDay"]:checked'))
        .map(cb => Number.parseInt(cb.value));

    if (!name) {
        alert(`${icons.get('alert')} El nombre de la posición es obligatorio`);
        return;
    }
    if (Number.isNaN(hourlyRate) || hourlyRate < 0) {
        alert(`${icons.get('alert')} La tarifa por hora debe ser mayor o igual a 0`);
        return;
    }

    // Verificar nombre único
    let finalName = name;
    if (state.editingPosition) {
        const existing = state.positions.find(p =>
            p.name.toLowerCase() === name.toLowerCase() &&
            p.id !== state.editingPosition.id
        );
        if (existing) {
            alert(`${icons.get('alert')} Ya existe una posición con ese nombre`);
            return;
        }
    } else {
        let counter = 1;
        const baseName = name;
        while (state.positions.some(p => p.name.toLowerCase() === finalName.toLowerCase())) {
            finalName = `${baseName} ${counter}`;
            counter++;
        }
        if (finalName !== name) {
            const confirmed = confirm(`Ya existe una posición llamada "${name}".\n¿Crear como "${finalName}"?`);
            if (!confirmed) return;
        }
    }

    if (state.editingPosition) {
        const pos = state.positions.find(p => p.id === state.editingPosition.id);
        pos.name = finalName;
        pos.hourlyRate = hourlyRate;
        pos.leaderId = leaderId;
        pos.color = color;
        pos.workingDays = workingDays;

        const dayEquivalent = state.settings.regularHoursPerDay * hourlyRate;
        const monthlyEquivalent = dayEquivalent * 4.345;
        const oneWeekWork = ( workingDays.length * dayEquivalent );// Cálculo para 1 semana labora
        const twoweeksWork = (2.0 * oneWeekWork);// Cálculo para 2 semanas laborales
        const treeWeeksWork = (3.0 * oneWeekWork);// Cálculo para 3 semanas laborales

        pos.salaryConfig = {
            amount: Math.round(monthlyEquivalent),
            period: 'month',
            workDays: [1, 2, 3, 4, 5, 6]
        };
        pos.updatedAt = Date.now();
        pos._isDirty = true;
    } else {
        const newId = finalName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
        const monthlyEquivalent = hourlyRate * state.settings.regularHoursPerDay * 30;

        state.positions.push({
            id: newId,
            name: finalName,
            hourlyRate: hourlyRate,
            workingDays: workingDays,
            leaderId: leaderId,
            color: color,
            active: true,
            salaryConfig: {
                amount: Math.round(monthlyEquivalent, 2),
                period: 'month',
                workDays: [1, 2, 3, 4, 5, 6]
            },
            updatedAt: Date.now()
        });
    }

    context.saveToLocalStorage();
    context.closeModal();
    context.render();
}

export function openEmployeeFloating(empId) {
    const state = getState();
    state.floatingCardEmployee = state.employees.find(e => e.id === empId);
    state.showFloatingCard = true;
    state.floatingCardMonth = new Date();
    context.render();
}

export function closeFloatingCard() {
    const state = getState();
    state.showFloatingCard = false;
    state.floatingCardEmployee = null;
    context.render();
}

export function changeFloatingMonth(delta) {
    const state = getState();
    state.floatingCardMonth.setMonth(state.floatingCardMonth.getMonth() + delta);
    state.floatingCardMonth = new Date(state.floatingCardMonth);
    context.render();
}

export function openEmployeeProfile(employeeId) {
    const state = getState();
    const emp = state.employees.find(e => e.id === employeeId || e.key === employeeId);
    if (!emp) {
        console.error('Empleado no encontrado:', employeeId);
        return;
    }

    const today = new Date();
    const lastPayment = emp.lastPaymentDate ? new Date(emp.lastPaymentDate + 'T00:00:00') : null;

    let start, end;
    if (lastPayment) {
        start = new Date(lastPayment);
        start.setDate(start.getDate() + 1);
        end = today;
    } else {
        start = new Date(today);
        start.setDate(start.getDate() - 14);
        end = today;
    }

    state.employeeProfile = {
        employeeId: emp.id,
        activeTab: 'nomina',
        periodStart: getDateKey(start),
        periodEnd: getDateKey(end),
        deductions: []
    };

    state.modalType = 'employee-profile';
    state.showModal = true;
    context.render();
}
