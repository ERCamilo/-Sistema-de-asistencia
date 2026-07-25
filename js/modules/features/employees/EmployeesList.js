/**
 * 👤 EmployeesList — Card template + handlers for employees.
 *
 * Sprint 7b: handlers moved here from EmployeesUI.js.
 */

import icons from '../../ui/IconSystem.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { state, stateManager } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData, enqueueEmployeeTombstone, ensureAllAttendanceHistory } from '../../services/PersistenceService.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { Modal } from '../../components/Modal.js';
import { EmployeeModal } from '../../ui/modals/EmployeeModal.js';
import { canDeleteEmployee } from '../../services/EmployeeDeletionGuard.js';
import { deleteEmployeePermanently } from '../../services/EmployeeDeletion.js';
import { countLiveAttendance } from '../../services/AttendanceCleanup.js';
import { purgeEmployeeAttendanceHistory } from '../../services/AttendanceCleanupRunner.js';
import {
    renderPositionIconSvg,
    renderPositionUiSvg,
    resolvePositionIcon,
    safePositionColor
} from './PositionVisuals.js';
import { hourlyToDaily } from '../payroll/SalaryConversion.js';
import { resolvePositionBaseHourlyRate } from './EmployeePositionMetrics.js';

const WEEKS_PER_MONTH = 52 / 12;
let employeeOpenFilter = null;

function formatMoney(amount) {
    return `$${Math.round(Number(amount) || 0).toLocaleString()}`;
}

export function getEmployeeEarningsDisplay(emp, positions) {
    const regularHours = Number(state.settings?.regularHoursPerDay) || 8;
    const amounts = positions.length
        ? positions.map(position => {
            const customRate = Number(emp.positionSalaries?.[position.id]);
            const hourlyRate = Number.isFinite(customRate) && customRate > 0
                ? customRate
                : resolvePositionBaseHourlyRate(position, regularHours);
            const dailyAmount = hourlyToDaily(hourlyRate, regularHours);
            const workDays = Array.isArray(position.workingDays) && position.workingDays.length
                ? position.workingDays.length
                : 6;
            return {
                daily: dailyAmount,
                monthly: dailyAmount * workDays * WEEKS_PER_MONTH
            };
        })
        : [{ daily: 0, monthly: 0 }];

    const buildPeriod = (period) => {
        const rounded = amounts.map(amount => Math.round(amount[period]));
        const minimum = Math.min(...rounded);
        const maximum = Math.max(...rounded);
        const isRange = minimum !== maximum;
        return {
            amount: isRange
            ? `${formatMoney(minimum)}–${formatMoney(maximum)}`
            : formatMoney(minimum),
            isRange
        };
    };

    const daily = buildPeriod('daily');
    const monthly = buildPeriod('monthly');

    return {
        daily,
        monthly,
        isRange: daily.isRange || monthly.isRange
    };
}

function getEmployeeViewData(emp) {
    const positions = (emp.positions || [])
        .map(positionId => state.positions.find(position => position.id === positionId))
        .filter(Boolean);
    const leaders = positions.map(position => {
        if (!position.leaderId) return null;
        return state.leaders.find(leader => leader.id === position.leaderId) || null;
    }).filter(Boolean);
    const earningsDisplay = getEmployeeEarningsDisplay(emp, positions);
    return { positions, leaders, earningsDisplay, primaryPosition: positions[0] || null };
}

export function EmployeeCard(emp, { selected = false } = {}) {
    const { positions, leaders, earningsDisplay, primaryPosition } = getEmployeeViewData(emp);
    const employeeId = escapeAttr(emp.key || emp.id);
    const color = safePositionColor(primaryPosition?.color);
    const icon = resolvePositionIcon(primaryPosition || {});
    const watermarkPositions = positions.slice(0, 3);
    const hiddenWatermarks = Math.max(0, positions.length - watermarkPositions.length);
    const leaderNumbers = [...new Set(leaders.map(leader => leader.number)
        .filter(value => value !== undefined && value !== null))];

    return `
        <article class="employee-row employee-list-row${selected ? ' is-selected' : ''}${emp.active ? '' : ' is-inactive'}"
                 data-action="open-employee-editor" data-id="${employeeId}"
                 style="--employee-position-color: ${color};">
            <span class="employee-list-row__number">${escapeHTML(String(emp.number || '—').padStart(3, '0'))}</span>
            <div class="employee-list-row__watermarks has-${watermarkPositions.length}" aria-hidden="true">
                ${watermarkPositions.map(position => `
                    <span style="--watermark-color: ${safePositionColor(position.color)};">
                        ${renderPositionIconSvg(resolvePositionIcon(position), { size: 42 })}
                    </span>
                `).join('')}
                ${hiddenWatermarks ? `<small>+${hiddenWatermarks}</small>` : ''}
            </div>
            <div class="employee-list-row__identity">
                <span class="employee-list-row__icon">
                    ${renderPositionIconSvg(icon, { size: 20 })}
                </span>
                <div>
                    <strong title="${escapeAttr(emp.name)}">${escapeHTML(emp.name)}</strong>
                    <div class="employee-list-row__positions">
                        ${positions.length ? positions.map(position => `
                            <span>${escapeHTML(position.name)}</span>
                        `).join('') : '<span class="is-empty">Sin puesto</span>'}
                        ${leaderNumbers.length
        ? `<small>${leaderNumbers.map(number => `L-${escapeHTML(String(number).padStart(3, '0'))}`).join(', ')}</small>`
        : ''}
                    </div>
                </div>
            </div>
            <div class="employee-list-row__salary"
                 title="${earningsDisplay.isRange ? 'Rango según los puestos asignados' : 'Tarifa del puesto asignado'}">
                <strong class="${earningsDisplay.daily.isRange ? 'is-range' : ''}">${earningsDisplay.daily.amount}<small>/día</small></strong>
                <span class="${earningsDisplay.monthly.isRange ? 'is-range' : ''}">${earningsDisplay.monthly.amount}<small>/mes</small></span>
            </div>
            <span class="employee-list-row__status ${emp.active ? 'is-active' : 'is-paused'}">
                ${emp.active ? 'Activo' : 'Pausado'}
            </span>
            <div class="employee-list-row__actions">
                <button type="button" data-action="open-employee-profile" data-id="${employeeId}"
                        aria-label="Ver perfil completo de ${escapeHTML(emp.name)}" title="Ver perfil completo">
                    ${renderPositionUiSvg('profile', { size: 16, className: 'employee-profile-icon' })}
                </button>
                <button type="button" data-action="open-employee-editor" data-id="${employeeId}"
                        aria-label="Editar empleado" title="Editar">
                    ${renderPositionUiSvg('edit', { size: 15 })}
                </button>
                <button type="button" data-action="toggle-employee-status" data-id="${employeeId}"
                        aria-label="${emp.active ? 'Desactivar empleado' : 'Activar empleado'}"
                        title="${emp.active ? 'Desactivar' : 'Activar'}">
                    ${renderPositionUiSvg(emp.active ? 'pause' : 'play', { size: 15 })}
                </button>
                ${!emp.active ? `
                    <button type="button" class="is-danger" data-action="delete-employee" data-id="${employeeId}"
                            aria-label="Eliminar empleado permanentemente" title="Eliminar permanentemente">
                        ${renderPositionUiSvg('trash', { size: 15 })}
                    </button>
                ` : ''}
            </div>
        </article>
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
            state.employeeFilters = createDefaultEmployeeFilters();
        }
        state.employeeFilters.status = filter;
    });
}

export function setEmployeeSearchFilter(value) {
    if (!state.employeeFilters) {
        state.employeeFilters = createDefaultEmployeeFilters();
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
            state.employeeFilters = createDefaultEmployeeFilters();
        }
        state.employeeFilters.positionId = positionId;
        state.employeeFilters.positionIds = positionId && positionId !== 'all' ? [positionId] : [];
    });
}

export function setEmployeeLeaderFilter(leaderId) {
    stateManager.batchSetState(() => {
        if (!state.employeeFilters) {
            state.employeeFilters = createDefaultEmployeeFilters();
        }
        state.employeeFilters.leaderId = leaderId;
        state.employeeFilters.leaderIds = leaderId && leaderId !== 'all' ? [leaderId] : [];
    });
}

function createDefaultEmployeeFilters() {
    return {
        search: '',
        positionId: 'all',
        leaderId: 'all',
        positionIds: [],
        leaderIds: [],
        status: 'active'
    };
}

function toggleFilterValue(currentValues, value, checked) {
    const values = new Set(Array.isArray(currentValues) ? currentValues : []);
    if (checked) values.add(value);
    else values.delete(value);
    return [...values];
}

export function toggleEmployeePositionFilter(positionId, checked) {
    employeeOpenFilter = 'positions';
    stateManager.batchSetState(() => {
        if (!state.employeeFilters) state.employeeFilters = createDefaultEmployeeFilters();
        state.employeeFilters.positionIds = toggleFilterValue(
            state.employeeFilters.positionIds,
            positionId,
            checked
        );
        state.employeeFilters.positionId = 'all';
    });
}

export function toggleEmployeeLeaderFilter(leaderId, checked) {
    employeeOpenFilter = 'leaders';
    stateManager.batchSetState(() => {
        if (!state.employeeFilters) state.employeeFilters = createDefaultEmployeeFilters();
        state.employeeFilters.leaderIds = toggleFilterValue(
            state.employeeFilters.leaderIds,
            leaderId,
            checked
        );
        state.employeeFilters.leaderId = 'all';
    });
}

export function setEmployeeFilterMenuOpen(kind, isOpen) {
    if (isOpen) {
        employeeOpenFilter = kind;
    } else if (employeeOpenFilter === kind) {
        employeeOpenFilter = null;
    }
}

export function getEmployeeOpenFilter() {
    return employeeOpenFilter;
}

export function filterEmployeeFilterOptions(input) {
    const query = String(input?.value || '').trim().toLocaleLowerCase('es');
    input?.closest('.employee-multifilter__popover')
        ?.querySelectorAll('[data-filter-label]')
        .forEach(option => {
            option.hidden = query
                ? !String(option.dataset.filterLabel || '').toLocaleLowerCase('es').includes(query)
                : false;
        });
}

export function resetEmployeeFilters() {
    employeeOpenFilter = null;
    stateManager.batchSetState(() => {
        state.employeeFilters = createDefaultEmployeeFilters();
        state.employeeStatusFilter = 'active';
    });
}

export function openEmployeeForm(employeeId = null) {
    EmployeeModal.open(employeeId);
}

export function openEmployeeEditor(employeeId) {
    const isCompact = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(max-width: 900px)').matches;
    if (isCompact) {
        EmployeeModal.open(employeeId);
        return;
    }
    const exists = state.employees.some(employee => employee.id === employeeId || employee.key === employeeId);
    if (!exists) return;
    stateManager.batchSetState(() => {
        state.selectedPersonnelEmployeeId = employeeId;
    });
}

export function setEmployeeSalaryView(view) {
    const nextView = view === 'day' ? 'day' : 'month';
    stateManager.batchSetState(() => {
        state.employeeSalaryView = nextView;
    });
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
