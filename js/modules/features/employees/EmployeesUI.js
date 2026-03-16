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
                            ${icons.get('settings')} Puestos
                        </button>
                    </div>
                </div>
            `;

    // Si es posiciones, mostrar contenido de posiciones
    if (isPositions) {
        const statusFilter = state.positionStatusFilter;
        const sortBy = state.positionSortBy;

        let filteredPositions = state.positions.filter(pos => {
            if (statusFilter === 'active') return pos.active;
            if (statusFilter === 'inactive') return !pos.active;
            return true;
        });

        filteredPositions.sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'salary') return (b.salaryConfig?.amount || 0) - (a.salaryConfig?.amount || 0);
            return 0;
        });

        return `
                    ${subTabsHTML}
                    <div class="date-controls" style="margin-bottom: 16px;">
                        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                            <button class="view-btn ${statusFilter === 'active' ? 'active' : ''}" onclick="setPositionStatusFilter('active')" style="flex: 1;">
                                Activas
                            </button>
                            <button class="view-btn ${statusFilter === 'inactive' ? 'active' : ''}" onclick="setPositionStatusFilter('inactive')" style="flex: 1;">
                                Inactivas
                            </button>
                            <button class="view-btn ${statusFilter === 'all' ? 'active' : ''}" onclick="setPositionStatusFilter('all')" style="flex: 1;">
                                Todas
                            </button>
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
    const statusFilter = state.employeeStatusFilter;

    // Filtrar por estado activo/inactivo
    let filteredItems = items.filter(item => {
        if (statusFilter === 'active') return item.active;
        if (statusFilter === 'inactive') return !item.active;
        return true; // all
    });

    // Ordenar: activos primero, luego inactivos
    filteredItems.sort((a, b) => {
        if (a.active === b.active) return a.name.localeCompare(b.name);
        return a.active ? -1 : 1;
    });

    return `
                ${subTabsHTML}
                <div class="date-controls" style="margin-bottom: 16px;">
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
                    <button class="view-btn" onclick="${isEmployees ? 'openEmployeeForm()' : 'openLeaderForm()'}" style="width: 100%; margin-top: 12px; background: #06b6d4; color: #000; border-color: #06b6d4;">
                        ${icons.get('add')} Nuevo ${isEmployees ? 'Empleado' : 'Lider'}
                    </button>
                </div>
                
                ${filteredItems.length === 0 ? `
                    <div style="text-align:center;padding:60px 20px;color:#64748b;">
                        <div style="font-size:4rem;margin-bottom:16px;opacity:0.3;">${isEmployees ? `${icons.get('personnel')}` : `${icons.get('key')}`}</div>
                        <div style="font-size:1.125rem;">No hay ${isEmployees ? 'empleados' : 'líderes'} ${statusFilter === 'active' ? 'activos' : statusFilter === 'inactive' ? 'inactivos' : ''}</div>
                    </div>
                ` : filteredItems.map(item => isEmployees ? EmployeeCard(item) : LeaderCard(item)).join('')}
            `;
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
                            <div class="employee-name" onclick="openEmployeeFloating('${emp.key || emp.id}')">${emp.name}</div>
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
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <button class="view-btn" onclick="openEmployeeProfile('${emp.key || emp.id}')" style="padding: 8px 16px; font-size: 0.875rem; background: linear-gradient(135deg, #06b6d4, #10b981); color: #000; font-weight: 700; border: none;" title="Ver perfil completo">${icons.get('user')}</button>
                        <button class="view-btn" onclick="openEmployeeForm('${emp.key || emp.id}')" style="padding: 8px 16px; font-size: 0.875rem;" title="Editar empleado">${icons.get('edit')}</button>
                        <button class="view-btn ${emp.active ? '' : 'active'}" onclick="toggleEmployeeStatus('${emp.key || emp.id}')" style="padding: 8px 16px; font-size: 0.875rem;" title="${emp.active ? 'Desactivar empleado' : 'Activar empleado'}">
                            ${emp.active ? `${icons.get('x-circle')}` : `${icons.get('check')}`}
                        </button>
                    </div>
                </div>
            `;
}

export function LeaderCard(ldr) {
    const state = getState();
    const positionsLed = state.positions.filter(p => p.leaderId === ldr.id && p.active).length;

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
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                         <button class="view-btn" onclick="openLeaderForm('${ldr.id}')" style="padding: 8px 16px; font-size: 0.875rem;" title="Editar lider">${icons.get('edit')}</button>
                         <button class="view-btn ${ldr.active ? '' : 'active'}" onclick="toggleLeaderStatus('${ldr.id}')" style="padding: 8px 16px; font-size: 0.875rem;" title="${ldr.active ? 'Desactivar líder' : 'Activar líder'}">
                            ${ldr.active ? `${icons.get('x-circle')}` : `${icons.get('check')}`}
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
    const canDelete = totalAssigned === 0;
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
                                    ${employeesInPosition.map((emp, idx) => `
                                        <div style="padding: 4px 0; color: #f1f5f9; ${idx < employeesInPosition.length - 1 ? 'border-bottom: 1px solid #334155;' : ''}">
                                            ${emp.name}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <button class="view-btn" onclick="openPositionForm('${pos.id}')" style="padding: 8px;" title="Editar posicion">${icons.get('edit')}</button>
                        <button class="view-btn ${pos.active ? '' : 'active'}" onclick="togglePositionStatus('${pos.id}')" style="padding: 8px;" title="${pos.active ? 'Desactivar posición' : 'Activar posición'}">
                            ${pos.active ? `${icons.get('x-circle')}` : `${icons.get('check')}`}
                        </button>
                        
                        ${pos.active ? "":
                            `<button class="view-btn" onclick="${canDelete ? `deletePosition('${pos.id}')` : ''}" style="padding: 8px; ${canDelete ? '' : 'opacity: 0.4; cursor: allowed;'}" title="${canDelete ? 'Eliminar posición' : 'No se puede eliminar: hay empleados asignados'}">
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
        Modal.confirm({
            title: `${icons.get('zap')} Número Duplicado`,
            message: `Ya existe un empleado con el número "${number}":\n${existingEmployee.name}\n\n¿Deseas usar el mismo número de todos modos?`,
            confirmText: 'Sí, continuar',
            cancelText: 'No, cambiar número',
            type: 'warning',
            onConfirm: () => saveEmployeeData(name, number, positions, phone, email, notes, hireDate, positionSalaries)
        });
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
            ]
        };

        state.employees.push(newEmployee);
        window.showAlert(`${icons.get('info')} Empleado ${name} creado correctamente`, 'success');
    }

    // Limpiar temporal
    state.tempPositionSalaries = {};

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
            notes: notes
        });
    }

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
                const changeDate = getDateKey(new Date());
                ldr.lastStatusChange = changeDate;

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
            context.render();
        }
    });
}

export function deletePosition(positionId) {
    const state = getState();
    const pos = state.positions.find(p => p.id === positionId);
    if (!pos) return;

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
            }
        });
    }

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
