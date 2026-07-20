/**
 * 👤 EmployeesList — Card template + handlers for employees.
 *
 * Sprint 7b: handlers moved here from EmployeesUI.js.
 */

import icons from '../../ui/IconSystem.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { state, stateManager } from '../../core/AppState.js';
import { payrollService as payroll } from '../../services/index.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData, enqueueEmployeeTombstone, ensureAllAttendanceHistory } from '../../services/PersistenceService.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { Modal } from '../../components/Modal.js';
import { EmployeeModal } from '../../ui/modals/EmployeeModal.js';
import { canDeleteEmployee } from '../../services/EmployeeDeletionGuard.js';
import { deleteEmployeePermanently } from '../../services/EmployeeDeletion.js';
import { countLiveAttendance } from '../../services/AttendanceCleanup.js';
import { purgeEmployeeAttendanceHistory } from '../../services/AttendanceCleanupRunner.js';

export function EmployeeCard(emp) {

    const leaders = (emp.positions || []).map(posId => {
        const pos = state.positions.find(p => p.id === posId);
        if (!pos || !pos.leaderId) return null;
        const ldr = state.leaders.find(l => l.id === pos.leaderId);
        return ldr ? ldr.number : null;
    }).filter(Boolean);

    const salaryConfig = payroll.getSalaryConfig(emp);
    const salaryDisplay = payroll.formatSalaryDisplay(salaryConfig);

    // ⚡ Detect "custom" salary in both legacy and new systems
    const hasPositionSalaries = emp.positionSalaries && Object.keys(emp.positionSalaries).length > 0;
    const isCustom = emp.salaryConfig?.type === 'custom' || emp.customSalary || hasPositionSalaries;
    const isMonthly = salaryConfig.period === 'month';
    const salaryType = isCustom ? 'Personalizado' : 'Estándar';
    const salaryLabel = isMonthly ? `Aprox. ${salaryType}` : salaryType;

    const createdDate = emp.createdDate
        ? new Date(emp.createdDate).toLocaleDateString('es-DO', { year: 'numeric', month: 'short', day: 'numeric' })
        : 'N/A';
    const lastChange = emp.lastStatusChange
        ? new Date(emp.lastStatusChange).toLocaleDateString('es-DO', { year: 'numeric', month: 'short', day: 'numeric' })
        : null;

    const statusBadge = emp.active
        ? '<span style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);"><span style="width: 6px; height: 6px; background: #fff; border-radius: 50%; animation: pulse 2s infinite;"></span>ACTIVO</span>'
        : '<span style="background: #475569; color: #cbd5e1; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><span style="width: 6px; height: 6px; background: #64748b; border-radius: 50%;"></span>INACTIVO</span>';

    return `
        <div class="employee-row" style="${!emp.active ? 'opacity: 0.6; border-color: #475569;' : ''}">
            <div class="employee-info" style="flex: 1;">
                <div class="employee-header">
                    <div class="employee-name" role="button" tabindex="0" data-action="open-employee-floating" data-id="${emp.key || emp.id}" title="${escapeAttr(emp.name)}">${escapeHTML(emp.name)}</div>
                    <div class="employee-number">${emp.number}</div>
                    ${statusBadge}
                </div>
                <div class="position-toggles">
                    ${(emp.positions || []).map(posId => {
        const pos = state.positions.find(p => p.id === posId);
        if (!pos) return `<span class="position-toggle" style="opacity:0.4;cursor:default;border-color:#475569;"><span class="pos-dot" style="background:#475569;"></span>⚠️ Eliminada</span>`;
        return `<span class="position-toggle" style="opacity:0.8;cursor:default;border-color:${pos.color};"><span class="pos-dot" style="background:${pos.color};"></span>${escapeHTML(pos.name)}</span>`;
    }).join('')}
                </div>
                <div class="employee-meta">
                    <div class="employee-meta-item">${icons.get('zap')} ${salaryDisplay.full} <span style="color: #64748b;">(${salaryLabel})</span></div>
                    ${leaders.length > 0 ? `<div class="employee-meta-divider"></div><div class="employee-meta-item">${icons.get('key')} ${leaders.join(', ')}</div>` : ''}
                </div>
                <div class="employee-meta" style="margin-top: 4px; font-size: 0.7rem;">
                    <div class="employee-meta-item" style="color: #64748b;">${icons.get('clock')} Trabaja: ${salaryDisplay.workDays}</div>
                </div>
                <div class="employee-meta" style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #1e293b;">
                    <div class="employee-meta-item" style="font-size: 0.7rem; color: #64748b;">${icons.get('calendar')} Creado: ${createdDate}</div>
                    ${lastChange ? `<div class="employee-meta-divider"></div><div class="employee-meta-item" style="font-size: 0.7rem; color: #64748b;">${emp.active ? `${icons.get('info')} Activado` : `${icons.get('x-circle')} Desactivado`}: ${lastChange}</div>` : ''}
                </div>

                <!-- 📝 General notes preview -->
                ${emp.notes && emp.notes.trim() ? `
                    <div class="employee-meta" style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                         title="${emp.notes.replace(/"/g, '&quot;')}">
                        <div class="employee-meta-item" style="color: #94a3b8; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 4px;">
                            ${icons.get('file', { size: 12 })} ${escapeHTML(emp.notes)}
                        </div>
                    </div>
                ` : ''}
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button class="view-btn" type="button" data-action="open-employee-profile" data-id="${emp.key || emp.id}" style="padding: 8px 16px; font-size: 0.875rem; background: linear-gradient(135deg, #06b6d4, #10b981); color: #000; font-weight: 700; border: none;" aria-label="Ver perfil completo">${icons.get('user')}</button>
                <button class="view-btn" type="button" data-action="open-employee-form" data-id="${emp.key || emp.id}" style="padding: 8px 16px; font-size: 0.875rem;" aria-label="Editar empleado">${icons.get('edit')}</button>
                <button class="view-btn ${emp.active ? '' : 'active'}" type="button" data-action="toggle-employee-status" data-id="${emp.key || emp.id}" style="padding: 8px 16px; font-size: 0.875rem;" aria-label="${emp.active ? 'Desactivar empleado' : 'Activar empleado'}">
                    ${emp.active ? `${icons.get('pause')}` : `${icons.get('play')}`}
                </button>
                ${!emp.active ? `
                <button class="view-btn" type="button" data-action="delete-employee" data-id="${emp.key || emp.id}" style="padding: 8px 16px; font-size: 0.875rem; border-color: rgba(239,68,68,0.4); color: #fca5a5;" aria-label="Eliminar empleado permanentemente" title="Eliminar permanentemente">
                    ${icons.get('delete')}
                </button>
                ` : ''}
            </div>
        </div>
    `;
}


// ─── Handlers ────────────────────────────────────────────────────────────────

export function changeEmployeeViewMode(mode) {
    stateManager.batchSetState(() => {
        state.employeeViewMode = mode;
    });
}

export function setEmployeeStatusFilter(filter) {
    stateManager.batchSetState(() => {
        state.employeeStatusFilter = filter;
        if (!state.employeeFilters) {
            state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
        }
        state.employeeFilters.status = filter;
    });
}

export function setEmployeeSearchFilter(value) {
    if (!state.employeeFilters) {
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
    }
    state.employeeFilters.search = value;

    // Surgical DOM update for search-as-you-type so the input keeps focus
    const input = document.querySelector('.employee-search-input');
    const keepFocus = input && document.activeElement === input;
    const cursorPos = keepFocus ? input.selectionStart : null;

    const list = document.getElementById('employees-list');
    if (list && (state.employeeViewMode || 'employees') === 'employees') {
        // We can't import buildEmployeesListHTML without a circular dep;
        // fall back to window if app.js wired it, otherwise full render.
        const builder = (typeof window !== 'undefined' && window.__buildEmployeesListHTML) || null;
        if (builder) {
            list.innerHTML = builder();
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
    }
    render();
}

export function setEmployeePositionFilter(positionId) {
    stateManager.batchSetState(() => {
        if (!state.employeeFilters) {
            state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
        }
        state.employeeFilters.positionId = positionId;
    });
}

export function setEmployeeLeaderFilter(leaderId) {
    stateManager.batchSetState(() => {
        if (!state.employeeFilters) {
            state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
        }
        state.employeeFilters.leaderId = leaderId;
    });
}

export function resetEmployeeFilters() {
    stateManager.batchSetState(() => {
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
        state.employeeStatusFilter = 'active';
    });
}

export function openEmployeeForm(employeeId = null) {
    EmployeeModal.open(employeeId);
}

export function toggleEmployeeStatus(employeeId) {
    const emp = state.employees.find(e => e.key === employeeId || e.id === employeeId);
    if (!emp) return;

    const action = emp.active ? 'desactivar' : 'activar';
    const actionPast = emp.active ? 'desactivado' : 'activado';

    Modal.confirm({
        title: emp.active ? `${icons.get('x-circle')} Desactivar Empleado` : `${icons.get('info')} Activar Empleado`,
        message: `¿Estás seguro de ${action} a ${escapeHTML(emp.name)}?`,
        confirmText: action === 'desactivar' ? 'Sí, desactivar' : 'Sí, activar',
        cancelText: 'Cancelar',
        type: emp.active ? 'warning' : 'info',
        onConfirm: () => {
            emp.active = !emp.active;
            const changeDate = getDateKey(new Date());
            emp.lastStatusChange = changeDate;
            emp.updatedAt = Date.now();
            emp._isDirty = true;

            // Keep a status-change history
            if (!emp.statusHistory) emp.statusHistory = [];
            emp.statusHistory.push({
                date: changeDate,
                active: emp.active,
                timestamp: new Date().getTime()
            });

            saveApplicationData();
            if (window.showAlert) {
                window.showAlert(`${icons.get('info')} Empleado ${escapeHTML(emp.name)} ${actionPast} correctamente`, 'success');
            }
            render();
        }
    });
}

/**
 * 🗑️ Eliminar un empleado de forma PERMANENTE (borrado robusto con tombstone).
 * Solo se ofrece para empleados pausados (ver EmployeeCard). Antes de pedir
 * confirmación se re-valida el guard (canDeleteEmployee): desactivado hace
 * >=30 días y sin préstamos con saldo pendiente. El diálogo pide una
 * declaración consciente de que ya se le pagó el período actual (no
 * verificable automáticamente).
 */
export async function deleteEmployeeHandler(employeeId) {
    const emp = state.employees.find(e => e.key === employeeId || e.id === employeeId);
    if (!emp) return;

    const check = canDeleteEmployee(emp);
    if (!check.ok) {
        if (window.showAlert) window.showAlert(`No se puede eliminar: ${check.reason}`, 'warning');
        else Modal.alert({ title: 'No se puede eliminar', message: check.reason });
        return;
    }

    try {
        await ensureAllAttendanceHistory();
    } catch (_) {
        window.showAlert?.('No se puede verificar el historial completo. Conéctate a Internet antes de eliminar el empleado.', 'warning');
        return;
    }

    Modal.confirm({
        title: `${icons.get('delete')} Eliminar empleado permanentemente`,
        message: `Vas a ELIMINAR de forma permanente a <strong>${escapeHTML(emp.name)}</strong>.<br><br>` +
            `Al confirmar declarás que ya se le pagaron los días trabajados del período actual y que no queda ninguna cuenta pendiente con este empleado.<br><br>` +
            `El empleado desaparecerá de todos tus dispositivos y no se puede deshacer fácilmente.`,
        confirmText: 'Sí, eliminar definitivamente',
        cancelText: 'Cancelar',
        type: 'danger',
        onConfirm: () => {
            const empId = emp.id;
            // Modal.confirm es async: LiveSync pudo reemplazar state.employees
            // mientras el diálogo estaba abierto (otro dispositivo agregó un
            // préstamo). El guard de saldo debe validar sobre datos frescos.
            const freshEmp = state.employees.find(e => e.id === empId) || emp;
            const r = deleteEmployeePermanently(freshEmp, {
                enqueueTombstone: (id, deletedAt) => enqueueEmployeeTombstone(id, deletedAt),
                removeFromState: (id) => {
                    stateManager.batchSetState(() => {
                        state.employees = state.employees.filter(e => e.id !== id);
                    });
                },
                persist: () => saveApplicationData({ immediate: true })
            });
            if (!r.ok) {
                if (window.showAlert) window.showAlert(`No se pudo eliminar: ${r.reason}`, 'warning');
                return;
            }
            if (window.showAlert) window.showAlert(`${icons.get('info')} Empleado ${escapeHTML(emp.name)} eliminado`, 'success');
            render();

            // Modal EXTRA: preguntar por el historial de asistencia. Si el
            // empleado tenía asistencia, ofrecer borrarla también (queda como
            // registro si el usuario elige conservarla).
            const attCount = countLiveAttendance(state.attendance, empId);
            if (attCount > 0) {
                Modal.confirm({
                    title: `${icons.get('delete')} ¿Eliminar también su historial?`,
                    message: `<strong>${escapeHTML(emp.name)}</strong> tiene <strong>${attCount}</strong> registro${attCount === 1 ? '' : 's'} de asistencia.<br><br>` +
                        `¿Querés eliminar también su historial? Si elegís "No", el empleado se elimina pero su asistencia queda como registro histórico.`,
                    confirmText: 'Sí, eliminar historial',
                    cancelText: 'No, conservar historial',
                    type: 'warning'
                }).then((alsoHistory) => {
                    if (!alsoHistory) return;
                    const removed = purgeEmployeeAttendanceHistory(empId);
                    if (window.showAlert) window.showAlert(`${icons.get('info')} ${removed} registro(s) de asistencia eliminados`, 'success');
                    render();
                });
            }
        }
    });
}
