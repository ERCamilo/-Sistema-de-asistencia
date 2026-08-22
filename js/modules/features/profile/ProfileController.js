/**
 * 👤 ProfileController — Handlers for the Employee Profile modal.
 *
 * Sprint 6 extraction. These handlers used to live in app.js as window.*
 * globals between lines 2005-2140 (core profile handlers), and at lines
 * 2845 (togglePositionBreakdown) and 2874 (markAsPaid).
 *
 * `registerLegacyGlobals()` re-binds them to window.* so the data-app-fn
 * dispatcher in app.js keeps resolving them.
 */

import { state, stateManager } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { mergeTombstoneMaps } from '../../services/NestedTombstones.js';
import { payrollService } from '../../services/index.js';
import { applyManualAdjustmentMovement } from '../payroll/PayrollAdjustmentManualMovement.js';
import {
    ADJUSTMENT_PLAN_STATUS,
    isPayrollAdjustmentInstallmentPlan
} from '../payroll/PayrollAdjustmentInstallmentPlan.js';
import {
    buildEmployeeScheduledAdjustmentPlans
} from '../payroll/PayrollAdjustmentScheduled.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function notify(message, type = 'info') {
    if (typeof window !== 'undefined' && window.showNotification) {
        window.showNotification(message, type);
    }
}

function alertMsg(message, type = 'info') {
    if (typeof window !== 'undefined' && window.showAlert) {
        window.showAlert(message, type);
    } else {
        notify(message, type);
    }
}

/**
 * 🔄 Sync the edit-time scratch data (deductions/bonuses/advances) into the
 * persistent employee record. Called on close and after every payroll edit.
 */
export function syncProfileToMaster(empId, saveOptions = {}) {
    if (!empId) return false;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp || !state.employeeProfile) return false;

    if (state.employeeProfile.deductions) emp.deductions = [...state.employeeProfile.deductions];
    if (state.employeeProfile.bonuses) emp.bonuses = [...state.employeeProfile.bonuses];
    if (state.employeeProfile.advances) emp.advances = [...state.employeeProfile.advances];

    // 🪦 P1: propagar al maestro los tombstones de items borrados en el
    // scratch — el merge con la nube los usa para que el borrado no resucite.
    if (state.employeeProfile.deletedItemIds) {
        emp.deletedItemIds = mergeTombstoneMaps(emp.deletedItemIds, state.employeeProfile.deletedItemIds);
    }

    // 🕒 Sin esto, el merge escalar (gana el de mayor updatedAt) trataba la
    // edición del perfil como "vieja" y una copia remota podía pisarla.
    emp.updatedAt = Date.now();

    // ⚡ Immediate save: a fast F5 immediately after editing was discarding the
    // 300ms-debounced save. Critical financial edits (advances, deductions,
    // bonuses) must persist before the tab can be reloaded.
    // saveOptions permite que el caller pida announce (toast honesto del resultado).
    saveApplicationData({ immediate: true, ...saveOptions });
    return true;
}


function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function currentUserLabel() {
    const user = globalThis.currentUser;
    return String(user?.displayName || user?.email || '').trim();
}

function createManualMovementId() {
    if (globalThis.crypto?.randomUUID) {
        return `ADJ-MANUAL-${globalThis.crypto.randomUUID()}`;
    }
    return `ADJ-MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function activeEmployeePlan(kind, planId) {
    const employee = state.employees.find(item =>
        String(item?.id) === String(state.employeeProfile?.employeeId)
    );
    const plan = (Array.isArray(employee?.[kind]) ? employee[kind] : [])
        .find(item => String(item?.id) === String(planId));
    if (!employee ||
        !isPayrollAdjustmentInstallmentPlan(plan) ||
        plan.kind !== kind ||
        String(plan.employeeId) !== String(employee.id)) {
        return null;
    }
    return { employee, plan };
}

function scheduledEmployeePlanAt(index) {
    const numericIndex = Number(index);
    if (!Number.isInteger(numericIndex) || numericIndex < 0) return null;
    const employee = state.employees.find(item =>
        String(item?.id) === String(state.employeeProfile?.employeeId)
    );
    if (!employee) return null;
    const projected = buildEmployeeScheduledAdjustmentPlans(employee)[numericIndex];
    return projected
        ? { kind: projected.kind, planId: projected.planId }
        : null;
}

export function openManualAdjustmentMovement(kind, planId) {
    const target = activeEmployeePlan(kind, planId);
    if (!target || target.plan.status !== ADJUSTMENT_PLAN_STATUS.ACTIVE) {
        notify('Este plan no está disponible para registrar movimientos.', 'warning');
        return false;
    }
    stateManager.batchSetState(() => {
        state.employeeProfile.manualAdjustmentDraft = {
            id: createManualMovementId(),
            kind,
            planId: String(planId),
            amount: '',
            date: getDateKey(new Date()),
            recordedBy: currentUserLabel(),
            note: ''
        };
    });
    render();
    return true;
}

export function openManualAdjustmentMovementAt(index) {
    const reference = scheduledEmployeePlanAt(index);
    if (!reference) {
        notify('Este plan no está disponible para registrar movimientos.', 'warning');
        return false;
    }
    return openManualAdjustmentMovement(reference.kind, reference.planId);
}

export function cancelManualAdjustmentMovement() {
    if (!state.employeeProfile) return;
    stateManager.batchSetState(() => {
        state.employeeProfile.manualAdjustmentDraft = null;
    });
    render();
}

export async function recordManualAdjustmentMovement(kind, planId, input = {}) {
    const target = activeEmployeePlan(kind, planId);
    if (!target) {
        notify('Este plan no pertenece al empleado seleccionado.', 'error');
        return false;
    }
    const employeeIndex = state.employees.indexOf(target.employee);
    let result;
    try {
        result = applyManualAdjustmentMovement(target.employee, {
            ...input,
            kind,
            planId
        });
    } catch (error) {
        notify(error.message || 'No se pudo registrar el movimiento.', 'warning');
        return false;
    }
    if (!result.changed) {
        notify('Este movimiento ya estaba registrado.', 'info');
        return true;
    }

    const previousEmployees = state.employees;
    const previousProfilePlans = state.employeeProfile?.[kind];
    const nextEmployees = [...state.employees];
    nextEmployees[employeeIndex] = result.employee;
    stateManager.batchSetState(() => {
        state.employees = nextEmployees;
        if (state.employeeProfile) {
            state.employeeProfile[kind] = clone(result.employee[kind]);
        }
    });

    let outcome;
    try {
        outcome = await saveApplicationData({
            immediate: true,
            announce: false,
            requireLocalSuccess: true
        });
    } catch (_) {
        outcome = { localOk: false, cloudRequested: false };
    }
    if (!outcome?.localOk) {
        stateManager.batchSetState(() => {
            state.employees = previousEmployees;
            if (state.employeeProfile) state.employeeProfile[kind] = previousProfilePlans;
        });
        notify(
            'No se pudo guardar el movimiento en este dispositivo. No se realizó ningún cambio.',
            'error'
        );
        render();
        return false;
    }

    stateManager.batchSetState(() => {
        if (state.employeeProfile) state.employeeProfile.manualAdjustmentDraft = null;
    });
    notify(
        kind === 'bonuses'
            ? 'Entrega registrada y guardada.'
            : 'Abono registrado y guardado.',
        'success'
    );
    render();
    return true;
}

export async function submitManualAdjustmentMovement(kind, planId) {
    const draft = state.employeeProfile?.manualAdjustmentDraft;
    const form = typeof document !== 'undefined'
        ? document.querySelector('[data-manual-adjustment-form]')
        : null;
    if (!draft || draft.kind !== kind || String(draft.planId) !== String(planId) || !form) {
        notify('Abre nuevamente el formulario para registrar el movimiento.', 'warning');
        return false;
    }
    const data = new FormData(form);
    return recordManualAdjustmentMovement(kind, planId, {
        id: draft.id,
        amount: data.get('manualAmount'),
        date: data.get('manualDate'),
        recordedBy: data.get('manualRecordedBy'),
        note: data.get('manualNote')
    });
}

export async function submitManualAdjustmentMovementAt(index) {
    const reference = scheduledEmployeePlanAt(index);
    if (!reference) {
        notify('Abre nuevamente el formulario para registrar el movimiento.', 'warning');
        return false;
    }
    return submitManualAdjustmentMovement(reference.kind, reference.planId);
}

// ─── Open / close ────────────────────────────────────────────────────────────

export function closeEmployeeProfile() {
    // Final sync before close — avoids losing edits to deductions/bonuses
    syncProfileToMaster(state.employeeProfile?.employeeId);
    // 🛡️ Migrate any newly-added legacy advances into emp.loans[] so they show
    // up in the Cuentas-por-Cobrar ledger the next time the user opens it.
    if (typeof window !== 'undefined' && typeof window.migrateAllAdvances === 'function') {
        try { window.migrateAllAdvances(); } catch (_) { /* never block close */ }
    }
    state.showEmployeeProfile = false;
    render();
}

export function changeProfileTab(tabName) {
    stateManager.batchSetState(() => {
        state.employeeProfile.activeTab = tabName;
    });
}

// ─── Hire-date picker ────────────────────────────────────────────────────────

export function changeProfileHireDateMonth(delta) {
    stateManager.batchSetState(() => {
        if (!state.profileHireDatePickerMonth) {
            state.profileHireDatePickerMonth = new Date();
        }
        state.profileHireDatePickerMonth.setMonth(
            state.profileHireDatePickerMonth.getMonth() + parseInt(delta, 10)
        );
        state.profileHireDatePickerMonth = new Date(state.profileHireDatePickerMonth);
    });
}

export function selectProfileHireDate(empId, dateKey) {
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return;

    stateManager.batchSetState(() => {
        emp.hireDate = dateKey;
        state.showProfileHireDatePicker = false;
    });
    saveApplicationData();
    notify(`📅 Fecha de contratación actualizada a ${dateKey}`, 'success');
    render();
}

// ─── Period pickers (start / end) ────────────────────────────────────────────

export function toggleProfileStartPicker() {
    stateManager.batchSetState(() => {
        state.employeeProfile.showStartPicker = !state.employeeProfile.showStartPicker;
        state.employeeProfile.showEndPicker = false;
        if (state.employeeProfile.showStartPicker) {
            state.employeeProfile.startPickerMonth =
                new Date(state.employeeProfile.periodStart + 'T00:00:00');
        }
    });
    render();
}

export function toggleProfileEndPicker() {
    stateManager.batchSetState(() => {
        state.employeeProfile.showEndPicker = !state.employeeProfile.showEndPicker;
        state.employeeProfile.showStartPicker = false;
        if (state.employeeProfile.showEndPicker) {
            state.employeeProfile.endPickerMonth =
                new Date(state.employeeProfile.periodEnd + 'T00:00:00');
        }
    });
    render();
}

export function changeProfileStartMonth(delta) {
    stateManager.batchSetState(() => {
        state.employeeProfile.startPickerMonth.setMonth(
            state.employeeProfile.startPickerMonth.getMonth() + parseInt(delta, 10)
        );
        state.employeeProfile.startPickerMonth = new Date(state.employeeProfile.startPickerMonth);
    });
}

export function changeProfileEndMonth(delta) {
    stateManager.batchSetState(() => {
        state.employeeProfile.endPickerMonth.setMonth(
            state.employeeProfile.endPickerMonth.getMonth() + parseInt(delta, 10)
        );
        state.employeeProfile.endPickerMonth = new Date(state.employeeProfile.endPickerMonth);
    });
}

export function changeProfileAsistenciaMonth(delta) {
    stateManager.batchSetState(() => {
        if (!state.employeeProfile.assistanceMonth) {
            state.employeeProfile.assistanceMonth = new Date();
        }
        state.employeeProfile.assistanceMonth.setMonth(
            state.employeeProfile.assistanceMonth.getMonth() + parseInt(delta, 10)
        );
        state.employeeProfile.assistanceMonth = new Date(state.employeeProfile.assistanceMonth);
    });
}

export function selectProfileStartDate(dateKey) {
    stateManager.batchSetState(() => {
        state.employeeProfile.periodStart = dateKey;
        state.employeeProfile.showStartPicker = false;
    });
    render();
}

export function selectProfileEndDate(dateKey) {
    stateManager.batchSetState(() => {
        state.employeeProfile.periodEnd = dateKey;
        state.employeeProfile.showEndPicker = false;
    });
    render();
}

// ─── Period presets ──────────────────────────────────────────────────────────

export function setProfilePeriod(preset) {
    const today = new Date();
    let start, end;

    switch (preset) {
        case '7days':
            start = new Date(today);
            start.setDate(start.getDate() - 6);
            end = today;
            break;
        case '15days':
            start = new Date(today);
            start.setDate(start.getDate() - 14);
            end = today;
            break;
        case 'month':
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            end = today;
            break;
        case 'payPeriod': {
            const pp = state.settings.payPeriod;
            if (pp?.periodStart) {
                start = new Date(pp.periodStart + 'T00:00:00');
                const len = pp.periodLength || 15;
                end = new Date(start);
                end.setDate(end.getDate() + len - 1);
            } else {
                alertMsg('❌ No hay período configurado. Ve a Ajustes > Calendario para configurarlo.', 'warning');
                return;
            }
            break;
        }
        case 'lastPayment': {
            const pp = state.settings.payPeriod;
            if (pp?.periodStart) {
                start = new Date(pp.periodStart + 'T00:00:00');
                end = today;
            } else {
                alertMsg('❌ No hay período configurado. Ve a Ajustes > Calendario para configurarlo.', 'warning');
                return;
            }
            break;
        }
        default:
            return;
    }

    stateManager.batchSetState(() => {
        state.employeeProfile.periodStart = getDateKey(start);
        state.employeeProfile.periodEnd = getDateKey(end);
        state.employeeProfile.activePeriod = preset;
    });
    render();
}

// ─── Position breakdown toggle (per-card) ────────────────────────────────────

export function togglePositionBreakdown(positionId) {
    if (!state.employeeProfile.expandedPositions) {
        state.employeeProfile.expandedPositions = {};
    }
    const isExpanded = !state.employeeProfile.expandedPositions[positionId];
    state.employeeProfile.expandedPositions[positionId] = isExpanded;

    // Optimization: only mutate the specific element instead of a full render
    const positionCard = document.querySelector(`[data-position-id="${positionId}"]`);
    if (!positionCard) {
        render();
        return;
    }
    const arrow = positionCard.querySelector('.position-arrow');
    if (arrow) arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
    const details = positionCard.querySelector('.position-details');
    if (details) details.style.display = isExpanded ? 'block' : 'none';
}

// ─── Mark as paid ────────────────────────────────────────────────────────────

export function markAsPaid() {
    const emp = state.employees.find(e => e.id === state.employeeProfile.employeeId);
    if (!emp) return;

    const today = getDateKey(new Date());
    if (!emp.paymentHistory) emp.paymentHistory = [];

    const period = `${state.employeeProfile.periodStart} to ${state.employeeProfile.periodEnd}`;
    const { neto } = payrollService.calculateEmployeePayroll(
        emp.id,
        state.employeeProfile.periodStart,
        state.employeeProfile.periodEnd,
        state.employeeProfile.deductions
    );

    emp.paymentHistory.push({
        date: today,
        amount: neto,
        period,
        deductionType: state.employeeProfile.deductionType,
        deductionValue: state.employeeProfile.deductionValue
    });

    saveApplicationData();
    alertMsg('✅ Marcado como pagado', 'success');
    render();
}

/**
 * Bind handlers to window.* for the legacy data-app-fn event delegation.
 */
export function registerLegacyGlobals() {
    if (typeof window === 'undefined') return;
    window.closeEmployeeProfile = closeEmployeeProfile;
    window.changeProfileTab = changeProfileTab;
    window.changeProfileHireDateMonth = changeProfileHireDateMonth;
    window.selectProfileHireDate = selectProfileHireDate;
    window.toggleProfileStartPicker = toggleProfileStartPicker;
    window.toggleProfileEndPicker = toggleProfileEndPicker;
    window.changeProfileStartMonth = changeProfileStartMonth;
    window.changeProfileEndMonth = changeProfileEndMonth;
    window.changeProfileAsistenciaMonth = changeProfileAsistenciaMonth;
    window.selectProfileStartDate = selectProfileStartDate;
    window.selectProfileEndDate = selectProfileEndDate;
    window.setProfilePeriod = setProfilePeriod;
    window.togglePositionBreakdown = togglePositionBreakdown;
    window.markAsPaid = markAsPaid;
    window.openManualAdjustmentMovement = openManualAdjustmentMovement;
    window.openManualAdjustmentMovementAt = openManualAdjustmentMovementAt;
    window.cancelManualAdjustmentMovement = cancelManualAdjustmentMovement;
    window.recordManualAdjustmentMovement = recordManualAdjustmentMovement;
    window.submitManualAdjustmentMovement = submitManualAdjustmentMovement;
    window.submitManualAdjustmentMovementAt = submitManualAdjustmentMovementAt;
}
