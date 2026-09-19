/**
 * 💵 LoansController — Side-effectful handlers for the Cuentas por Cobrar view.
 *
 * Bridges DOM events (via window.* + data-app-fn) to LoansService operations,
 * then persists via saveApplicationData() and re-renders.
 *
 * Owns the state fields:
 *   state.payrollViewMode               'generator' | 'ledger'
 *   state.loansLedger = {
 *     selectedEmployeeId: null,         null = list view, id = drilldown
 *     search: '',                       filter the list
 *     showAddForm: false,               toggles the new-loan form
 *     newLoanDraft: { ... },            in-progress form values
 *     showPaymentForm: { loanId },      payment form for a specific loan
 *     paymentDraft: { ... }
 *   }
 */

import { state, stateManager } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { getDateKey } from '../../utils/DateUtils.js';
import {
    createLoan,
    recordPayment,
    voidPayment,
    writeOffLoan,
    reopenLoan,
    deleteLoan,
    refinanceLoan,
    voidRefinancing,
    consolidateLoans,
    getCalendarPeriodWeeks,
    migrateAdvancesToLoans,
    getBalance,
    LOAN_STATUS,
    INSTALLMENT_MODE,
    VALIDATION
} from './LoansService.js';
import { findSimilarExistingLoan } from './LoanDuplicateDetector.js';
import { resolveDuplicateAsDistinct, resolveDuplicateByDeleting } from './LoanDuplicateResolver.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { assertTandaBBlockedWhenScoped } from '../../config/TandaBGate.js';
import { entityInScope, peekEntityScope } from '../projects/ProjectContext.js';
import { captureEntityProjectScope } from '../projects/EntityProjectScope.js';
import {
    createLoanPaymentDraft,
    updateLoanPaymentDraft,
    resolveLoanPaymentDraft,
    PAYMENT_PLAN_MODE
} from './LoanPaymentPlan.js';

// ─── State scaffolding ───────────────────────────────────────────────────────

function ensureLedgerState() {
    stateManager.batchSetState(() => {
        if (!state.loansLedger) {
            state.loansLedger = {
                selectedEmployeeId: null,
                search: '',
                showAddForm: false,
                newLoanDraft: createEmptyLoanDraft(),
                showPaymentFormForLoan: null,
                paymentDraft: {
                    amount: 0,
                    date: getDateKey(new Date()),
                    note: '',
                    mode: PAYMENT_PLAN_MODE.CUSTOM,
                    installmentCount: 1
                },
                showEmployeePicker: false,
                pickerSearch: '',
                showInactiveHistory: false,
                showRefinanceFormForLoan: null,
                refinanceDraft: createEmptyRefinanceDraft(),
                filterView: 'active',
                sortBy: 'balance',
                sortOrder: 'desc',
                amountFilter: 'all',
                dateFilter: 'all',
                showFilterMenu: false,
                displayMode: 'grouped'
            };
        } else {
            // Backfill new fields on pre-existing ledger objects (older sessions)
            if (typeof state.loansLedger.showEmployeePicker === 'undefined') {
                state.loansLedger.showEmployeePicker = false;
            }
            if (typeof state.loansLedger.pickerSearch === 'undefined') {
                state.loansLedger.pickerSearch = '';
            }
            if (typeof state.loansLedger.showInactiveHistory === 'undefined') {
                state.loansLedger.showInactiveHistory = false;
            }
            if (typeof state.loansLedger.showRefinanceFormForLoan === 'undefined') {
                state.loansLedger.showRefinanceFormForLoan = null;
            }
            if (typeof state.loansLedger.refinanceDraft === 'undefined') {
                state.loansLedger.refinanceDraft = createEmptyRefinanceDraft();
            }
            if (typeof state.loansLedger.filterView === 'undefined') {
                state.loansLedger.filterView = 'active';
            }
            if (typeof state.loansLedger.sortBy === 'undefined') {
                state.loansLedger.sortBy = 'balance';
            }
            if (typeof state.loansLedger.sortOrder === 'undefined') {
                state.loansLedger.sortOrder = 'desc';
            }
            if (typeof state.loansLedger.amountFilter === 'undefined') {
                state.loansLedger.amountFilter = 'all';
            }
            if (typeof state.loansLedger.dateFilter === 'undefined') {
                state.loansLedger.dateFilter = 'all';
            }
            if (typeof state.loansLedger.showFilterMenu === 'undefined') {
                state.loansLedger.showFilterMenu = false;
            }
            if (typeof state.loansLedger.displayMode === 'undefined') {
                state.loansLedger.displayMode = 'grouped';
            }
            if (typeof state.loansLedger.showConsolidateForm === 'undefined') {
                state.loansLedger.showConsolidateForm = false;
            }
            if (typeof state.loansLedger.consolidateDraft === 'undefined') {
                state.loansLedger.consolidateDraft = null;
            }
            if (typeof state.loansLedger.showSettingsModal === 'undefined') {
                state.loansLedger.showSettingsModal = false;
            }
        }
    });
}

function createEmptyRefinanceDraft() {
    return { basis: 'balance', mode: 'lump', interestRate: 0, installmentCount: 2, installmentFrequencyWeeks: 2, note: '' };
}

function createEmptyLoanDraft() {
    return {
        principal: 0,
        interestRate: 0,
        interestIncluded: false,
        startDate: getDateKey(new Date()),
        concept: '',
        installmentMode: INSTALLMENT_MODE.LUMP,
        installmentCount: 4,
        installmentFrequencyWeeks: 2
    };
}

function notify(msg, type = 'info') {
    if (typeof window !== 'undefined' && window.showNotification) {
        window.showNotification(msg, type);
    }
}

function alertMsg(msg, type = 'error') {
    if (typeof window !== 'undefined' && window.showAlert) {
        window.showAlert(msg, type);
    } else {
        notify(msg, type);
    }
}

function findScopedLoanEmployee(employeeId) {
    if (!employeeId) return null;
    const projectScope = peekEntityScope();
    const employee = (state.employees || []).find(item => String(item.id) === String(employeeId));
    return employee && entityInScope(employee, projectScope) ? employee : null;
}

function rejectForeignLoanEmployee(employeeId) {
    const projectScope = peekEntityScope();
    if (!projectScope.enabled || !projectScope.projectId) return true;
    const employee = findScopedLoanEmployee(employeeId);
    if (employee) return employee;
    alertMsg('Empleado no disponible en el proyecto activo');
    return null;
}

// ─── One-time migration on app boot ──────────────────────────────────────────

/**
 * Migrate the legacy emp.advances[] arrays to emp.loans[] for every employee.
 * Idempotent — safe to run on every boot. Called from app.js after data load.
 */
export function migrateAllAdvances() {
    assertTandaBBlockedWhenScoped('LoansController.migrateAllAdvances');
    if (!state.employees) return 0;
    let total = 0;
    for (const emp of state.employees) {
        total += migrateAdvancesToLoans(emp);
    }
    if (total > 0) {
        if (window.debug) window.debug.log(`💵 Migrated ${total} legacy advances to loans across all employees`);
        saveApplicationData({ immediate: true });
    }
    return total;
}

// ─── Selection / navigation ──────────────────────────────────────────────────

export function selectLoansEmployee(employeeId) {
    ensureLedgerState();
    if (!rejectForeignLoanEmployee(employeeId)) return false;
    stateManager.batchSetState(() => {
        state.loansLedger.selectedEmployeeId = employeeId;
        state.loansLedger.showAddForm = false;
        state.loansLedger.showPaymentFormForLoan = null;
    });
}

export function clearLoansEmployee() {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.selectedEmployeeId = null;
        state.loansLedger.showAddForm = false;
        state.loansLedger.showPaymentFormForLoan = null;
        state.loansLedger.showSettingsModal = false;
    });
}

export function setLoansSearch(value) {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.search = String(value || '');
    });
    render();
}

export function setLoansFilterView(view) {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.filterView = String(view || 'active');
    });
    render();
}

export function setLoansSortBy(criteria) {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        if (state.loansLedger.sortBy === criteria) {
            state.loansLedger.sortOrder = state.loansLedger.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            state.loansLedger.sortBy = criteria;
            state.loansLedger.sortOrder = criteria === 'number' ? 'asc' : 'desc';
        }
    });
    render();
}

export function setLoansSortOrder(order) {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.sortOrder = order === 'asc' ? 'asc' : 'desc';
    });
    render();
}

export function setLoansAmountFilter(range) {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.amountFilter = String(range || 'all');
    });
    render();
}

export function setLoansDateFilter(range) {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.dateFilter = String(range || 'all');
    });
    render();
}

export function toggleLoansFilterMenu() {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.showFilterMenu = !state.loansLedger.showFilterMenu;
    });
    render();
}

export function resetLoansFilters() {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.search = '';
        state.loansLedger.amountFilter = 'all';
        state.loansLedger.dateFilter = 'all';
    });
    render();
}

export function setLoansDisplayMode(mode) {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.displayMode = mode === 'individual' ? 'individual' : 'grouped';
    });
    render();
}

// ─── Employee picker (Add new → choose employee → open profile) ─────────────

/**
 * Open the employee picker shown over the Cuentas-por-Cobrar overview when
 * the user hits "+ Nueva". From there a click on any employee row routes
 * them into the employee profile modal on the Nómina tab so they can
 * register a loan/advance through the existing in-profile UI.
 */
export function openLoansEmployeePicker() {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.showEmployeePicker = true;
        state.loansLedger.pickerSearch = '';
    });
}

export function closeLoansEmployeePicker() {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.showEmployeePicker = false;
    });
}

export function setLoansPickerSearch(value) {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.pickerSearch = String(value || '');
    });
}

/**
 * 📊 Sentido inverso: del PERFIL al LEDGER.
 * Cierra el modal del perfil del empleado, preselecciona al empleado en
 * el ledger de Cuentas por Cobrar, navega a esa vista y abre el form
 * de "Nuevo préstamo" (el usuario vino aquí justamente a registrar).
 *
 * Reemplaza el flujo dual viejo donde se podía registrar tanto desde el
 * perfil (via emp.advances[]) como desde el ledger. Ahora el perfil es
 * solo-lectura; este handler es el puente.
 *
 * Defensivo si window.openCuentasPorCobrar no está disponible: prepara
 * el state del ledger igual para que la próxima navegación manual lo
 * encuentre listo.
 */
export function openLoansLedgerFor(employeeId) {
    if (!employeeId) return false;
    ensureLedgerState();
    if (!rejectForeignLoanEmployee(employeeId)) return false;

    stateManager.batchSetState(() => {
        // 1. Cerrar el modal del perfil si estaba abierto.
        if (typeof state !== 'undefined') {
            state.showEmployeeProfile = false;
        }

        // 2. Preseleccionar al empleado en el ledger.
        state.loansLedger.selectedEmployeeId = employeeId;
        state.loansLedger.showPaymentFormForLoan = null;

        // 3. Abrir el formulario de nuevo préstamo (el usuario vino a registrar).
        state.loansLedger.showAddForm = true;
        state.loansLedger.newLoanDraft = createEmptyLoanDraft();
    });

    // 4. Navegar a la vista de Cuentas por Cobrar (defensivo).
    if (typeof window !== 'undefined' && typeof window.openCuentasPorCobrar === 'function') {
        window.openCuentasPorCobrar();
    }
}

/**
 * 🎯 Tras elegir un empleado en el picker, lleva al usuario DIRECTO al
 * formulario de nuevo préstamo, sin abrir el perfil. Es el flujo correcto
 * desde que el perfil pasó a ser read-only para préstamos: el picker
 * abría el perfil porque ahí estaba antes el form, pero ese paso intermedio
 * ya no aporta nada — solo agrega clics.
 *
 * Funciona igual para empleados con o sin préstamos previos.
 */
export function pickEmployeeForNewLoan(employeeId) {
    if (!employeeId) return false;
    ensureLedgerState();
    if (!rejectForeignLoanEmployee(employeeId)) return false;
    stateManager.batchSetState(() => {
        state.loansLedger.showEmployeePicker = false;
        state.loansLedger.selectedEmployeeId = employeeId;
        state.loansLedger.showPaymentFormForLoan = null;
        state.loansLedger.showAddForm = true;
        state.loansLedger.newLoanDraft = createEmptyLoanDraft();
    });
}

/**
 * ⚠️ DEPRECATED: alias hacia atrás de pickEmployeeForNewLoan.
 *
 * Antes esta función abría el perfil del empleado en la pestaña Nómina
 * porque ahí estaba el editor de adelantos. Tras la unificación de
 * préstamos (perfil read-only, registro solo desde Cuentas por Cobrar),
 * el comportamiento correcto es ir directo al formulario en el ledger.
 *
 * Se conserva el nombre exportado para no romper imports externos
 * mientras se hace el grep de callers. La UI ya no lo usa (LoansLedger
 * apunta a pickEmployeeForNewLoan).
 */
export function openProfileForLoan(employeeId) {
    return pickEmployeeForNewLoan(employeeId);
}

// ─── New loan form ───────────────────────────────────────────────────────────

export function toggleAddLoanForm() {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.showAddForm = !state.loansLedger.showAddForm;
        if (state.loansLedger.showAddForm) {
            state.loansLedger.newLoanDraft = createEmptyLoanDraft();
        }
    });
}

export function setLoanDraftField(field, value) {
    ensureLedgerState();
    const draft = state.loansLedger.newLoanDraft;
    if (!draft) return;
    if (field === 'principal' || field === 'interestRate' || field === 'installmentCount' || field === 'installmentFrequencyWeeks') {
        draft[field] = Number(value) || 0;
    } else if (field === 'interestIncluded') {
        draft[field] = !!value;
    } else {
        draft[field] = value;
    }
    // Re-render when mode, principal, or interest changes, or while installments
    // are enabled, so the capacity meter and previews update live.
    if (field === 'installmentMode' || field === 'principal' || field === 'interestRate' || draft.installmentMode === INSTALLMENT_MODE.INSTALLMENTS) {
        render();
    }
}

function _doCreateLoan(emp) {
    const draft = state.loansLedger.newLoanDraft;
    try {
        const loan = createLoan(emp, draft, { projectScope: captureEntityProjectScope() });
        state.loansLedger.showAddForm = false;
        state.loansLedger.newLoanDraft = createEmptyLoanDraft();
        // Toast honesto: lo emite SaveOutcomeNotifier con el resultado REAL.
        // concept escapado: el toast lo renderiza por innerHTML (Notification.render).
        saveApplicationData({ immediate: true, announce: `Préstamo registrado: ${escapeHTML(loan.concept)}` });
        render();
    } catch (err) {
        alertMsg(`❌ ${err.message}`);
    }
}

export function submitNewLoan() {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    if (!empId) {
        alertMsg('Selecciona un empleado primero');
        return;
    }
    const emp = findScopedLoanEmployee(empId);
    if (!emp) {
        alertMsg('Empleado no disponible en el proyecto activo');
        return;
    }

    // Fase 2 U4 — guard SUAVE anti doble-registro: si ya existe un préstamo
    // muy parecido (mismo monto, fecha cercana, no anulado), preguntar antes
    // de crear. Cubre el doble click en un dispositivo Y el caso cross-device
    // (el préstamo del otro dispositivo ya llegó por LiveSync y el usuario
    // está por anotarlo de nuevo). Suave a propósito: si no hay mecanismo de
    // confirmación disponible, crea directo — nunca bloquea el trabajo.
    const similar = findSimilarExistingLoan(emp, state.loansLedger.newLoanDraft);
    if (similar && typeof window !== 'undefined' && typeof window.showConfirm === 'function') {
        window.showConfirm({
            title: 'Préstamo parecido ya registrado',
            message: `Este empleado ya tiene un préstamo por el MISMO monto con fecha cercana ` +
                `("${escapeHTML(similar.concept || 'Préstamo')}", ${escapeHTML(similar.startDate)}). ` +
                `Puede que ya esté anotado — quizá desde otro dispositivo.<br><br>` +
                `¿Registrar este préstamo de todas formas?`,
            confirmText: 'Sí, registrar igual',
            cancelText: 'Cancelar',
            type: 'warning',
            onConfirm: () => _doCreateLoan(emp)
        });
        return;
    }

    _doCreateLoan(emp);
}

// ─── Payment (abono) form ────────────────────────────────────────────────────

export function togglePaymentForm(loanId) {
    ensureLedgerState();
    const open = state.loansLedger.showPaymentFormForLoan === loanId
        ? null
        : loanId;
    const employee = findScopedLoanEmployee(state.loansLedger.selectedEmployeeId);
    const loan = (employee?.loans || []).find(item => String(item.id) === String(loanId));
    stateManager.batchSetState(() => {
        state.loansLedger.showPaymentFormForLoan = open;
        if (open) state.loansLedger.showRefinanceFormForLoan = null;
        state.loansLedger.paymentDraft = open && loan
            ? createLoanPaymentDraft(loan, getDateKey(new Date()))
            : {
                amount: 0,
                date: getDateKey(new Date()),
                note: '',
                mode: PAYMENT_PLAN_MODE.CUSTOM,
                installmentCount: 1
            };
    });
    render();
}

export function setPaymentDraftField(field, value) {
    ensureLedgerState();
    const draft = state.loansLedger.paymentDraft;
    if (!draft) return;
    const employee = findScopedLoanEmployee(state.loansLedger.selectedEmployeeId);
    const loan = (employee?.loans || []).find(item =>
        String(item.id) === String(state.loansLedger.showPaymentFormForLoan)
    );
    if (!loan) return;

    stateManager.batchSetState(() => {
        state.loansLedger.paymentDraft = updateLoanPaymentDraft(loan, draft, field, value);
    });
    if (field === 'mode' || field === 'installmentCount' || field === 'partialAmount' || field === 'toggleInstallment' || field === 'amount') {
        render();
    }
}

export function submitPayment(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = findScopedLoanEmployee(empId);
    if (!emp) {
        alertMsg('Empleado no disponible en el proyecto activo');
        return;
    }
    const loan = (emp.loans || []).find(item => String(item.id) === String(loanId));
    if (!loan) {
        alertMsg('Préstamo no encontrado');
        return;
    }
    try {
        const resolvedDraft = resolveLoanPaymentDraft(loan, state.loansLedger.paymentDraft);
        const payment = recordPayment(emp, loanId, resolvedDraft, { projectScope: captureEntityProjectScope() });
        state.loansLedger.showPaymentFormForLoan = null;
        saveApplicationData({ immediate: true, announce: `Abono registrado: ${payment.amount.toFixed(2)}` });
        render();
    } catch (err) {
        alertMsg(`❌ ${err.message}`);
    }
}

// ─── Loan operations ─────────────────────────────────────────────────────────

export function settleLoanByFullPayment(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = findScopedLoanEmployee(empId);
    if (!emp) return;
    const loan = (emp.loans || []).find(l => l.id === loanId);
    if (!loan) return;

    const balance = getBalance(loan);
    if (balance <= 0) {
        notify('Este préstamo ya está saldado', 'info');
        return;
    }
    const doSettle = () => {
        try {
            const currentEmp = findScopedLoanEmployee(empId);
            if (!currentEmp) return;
            recordPayment(currentEmp, loanId, { amount: balance, date: getDateKey(new Date()), note: 'Saldo completo' }, { projectScope: captureEntityProjectScope() });
            saveApplicationData({ immediate: true, announce: 'Préstamo saldado' });
            render();
        } catch (err) {
            alertMsg(`❌ ${err.message}`);
        }
    };
    if (!window.showConfirm) {
        // Fallback if Modal.confirm shim is unavailable
        doSettle();
        return;
    }
    window.showConfirm({
        title: 'Saldar préstamo',
        message: `¿Registrar un abono final de ${balance.toFixed(2)} para saldar este préstamo?`,
        confirmText: 'Sí, saldar',
        cancelText: 'Cancelar',
        type: 'info',
        onConfirm: doSettle
    });
}

export function writeOffLoanWithConfirm(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = findScopedLoanEmployee(empId);
    if (!emp) return;

    const doWriteOff = () => {
        try {
            const currentEmp = findScopedLoanEmployee(empId);
            if (!currentEmp) return;
            writeOffLoan(currentEmp, loanId, null, { projectScope: captureEntityProjectScope() });
            saveApplicationData({ immediate: true, announce: 'Préstamo anulado' });
            render();
        } catch (err) {
            alertMsg(`❌ ${err.message}`);
        }
    };

    if (!window.showConfirm) {
        doWriteOff();
        return;
    }
    window.showConfirm({
        title: 'Eliminar préstamo',
        message: 'El préstamo se marcará como anulado. El historial se conserva pero no aparecerá en el resumen de saldos. ¿Continuar?',
        confirmText: 'Sí, anular',
        cancelText: 'Cancelar',
        type: 'warning',
        onConfirm: doWriteOff
    });
}

export function reopenLoanHandler(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = findScopedLoanEmployee(empId);
    if (!emp) return;
    try {
        reopenLoan(emp, loanId, { projectScope: captureEntityProjectScope() });
        saveApplicationData({ immediate: true, announce: 'Préstamo reactivado' });
        render();
    } catch (err) {
        alertMsg(`❌ ${err.message}`);
    }
}

/**
 * Borra de forma PERMANENTE un préstamo anulado (written-off). A diferencia de
 * writeOffLoan (que solo lo archiva), deleteLoan lo saca de emp.loans[] y deja
 * un tombstone para que no reaparezca tras el sync. Acción irreversible, por eso
 * pide confirmación explícita.
 */
export function deleteLoanWithConfirm(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = findScopedLoanEmployee(empId);
    if (!emp) return;

    const doDelete = () => {
        try {
            const currentEmp = findScopedLoanEmployee(empId);
            if (!currentEmp) return;
            deleteLoan(currentEmp, loanId, { projectScope: captureEntityProjectScope() });
            saveApplicationData({ immediate: true, announce: 'Préstamo eliminado' });
            render();
        } catch (err) {
            alertMsg(`❌ ${err.message}`);
        }
    };

    if (!window.showConfirm) { doDelete(); return; }
    window.showConfirm({
        title: 'Eliminar préstamo anulado',
        message: 'El préstamo anulado se eliminará de forma PERMANENTE, junto con su historial de abonos. Esta acción no se puede deshacer. ¿Continuar?',
        confirmText: 'Sí, eliminar',
        cancelText: 'Cancelar',
        type: 'warning',
        onConfirm: doDelete
    });
}

export function voidPaymentHandler(loanId, paymentId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = findScopedLoanEmployee(empId);
    if (!emp) return;

    const doVoid = () => {
        try {
            const currentEmp = findScopedLoanEmployee(empId);
            if (!currentEmp) return;
            voidPayment(currentEmp, loanId, paymentId, null, { projectScope: captureEntityProjectScope() });
            saveApplicationData({ immediate: true, announce: 'Abono anulado' });
            render();
        } catch (err) {
            alertMsg(`❌ ${err.message}`);
        }
    };

    if (!window.showConfirm) {
        doVoid();
        return;
    }
    window.showConfirm({
        title: 'Anular abono',
        message: 'El abono se marcará como anulado y el saldo se recalculará. ¿Continuar?',
        confirmText: 'Sí, anular',
        cancelText: 'Cancelar',
        type: 'warning',
        onConfirm: doVoid
    });
}

// ─── Refinanciamiento ─────────────────────────────────────────────────────────

export function toggleRefinanceForm(loanId) {
    ensureLedgerState();
    const open = state.loansLedger.showRefinanceFormForLoan === loanId ? null : loanId;
    // Pre-llenar la tasa con la del préstamo (editable).
    let rate = 0;
    if (open) {
        const emp = findScopedLoanEmployee(state.loansLedger.selectedEmployeeId);
        const loan = (emp?.loans || []).find(l => l.id === loanId);
        rate = Number(loan?.interestRate || 0);
    }
    stateManager.batchSetState(() => {
        state.loansLedger.showRefinanceFormForLoan = open;
        if (open) state.loansLedger.showPaymentFormForLoan = null;
        state.loansLedger.refinanceDraft = {
            basis: 'balance',
            mode: 'lump',
            interestRate: rate,
            installmentCount: 2,
            installmentFrequencyWeeks: 2,
            note: ''
        };
    });
    render();
}

export function setRefinanceDraftField(field, value) {
    ensureLedgerState();
    const draft = state.loansLedger.refinanceDraft;
    if (!draft) return;
    if (field === 'installmentCount') {
        draft.installmentCount = Number(value) || 0;
        if (draft.installmentCount > 0) {
            draft.mode = 'installments';
        }
    } else if (field === 'interestRate' || field === 'installmentFrequencyWeeks') {
        draft[field] = Number(value) || 0;
    } else {
        draft[field] = value;
    }
    // Re-render para actualizar el preview del interés a agregar.
    render();
}

export function submitRefinance(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = findScopedLoanEmployee(empId);
    if (!emp) {
        alertMsg('Empleado no disponible en el proyecto activo');
        return;
    }
    const draft = state.loansLedger.refinanceDraft || {};
    const isInstallments = draft.mode !== 'lump' && (draft.mode === 'installments' || (draft.installmentCount != null && Number(draft.installmentCount) > 0));
    const params = {
        basis: draft.basis === 'principal' ? 'principal' : 'balance',
        interestRate: Number(draft.interestRate || 0),
        note: (draft.note || '').trim()
    };
    if (isInstallments) {
        params.installmentCount = Number(draft.installmentCount || 2);
        params.installmentFrequencyWeeks = Number(draft.installmentFrequencyWeeks || 2);
        params.replacement = true;
    } else {
        params.installmentCount = null;
        params.replacement = false;
    }
    try {
        const ev = refinanceLoan(emp, loanId, params, { projectScope: captureEntityProjectScope() });
        state.loansLedger.showRefinanceFormForLoan = null;
        saveApplicationData({ immediate: true, announce: `Préstamo refinanciado: +${ev.interestAmount.toFixed(2)} de interés` });
        render();
    } catch (err) {
        alertMsg(`❌ ${err.message}`);
    }
}

/**
 * Anula un refinanciamiento cargado por error. Soft-void: conserva el evento
 * pero lo saca del cálculo. Pide confirmación porque mueve el saldo.
 */
export function voidRefinanceHandler(loanId, refinId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = findScopedLoanEmployee(empId);
    if (!emp) return;

    const doVoid = () => {
        try {
            const currentEmp = findScopedLoanEmployee(empId);
            if (!currentEmp) return;
            voidRefinancing(currentEmp, loanId, refinId, null, { projectScope: captureEntityProjectScope() });
            saveApplicationData({ immediate: true, announce: 'Refinanciamiento anulado' });
            render();
        } catch (err) {
            alertMsg(`❌ ${err.message}`);
        }
    };

    if (!window.showConfirm) { doVoid(); return; }
    window.showConfirm({
        title: 'Anular refinanciamiento',
        message: 'Se quitará el interés de este refinanciamiento y el saldo se recalculará. El registro queda en el historial. ¿Continuar?',
        confirmText: 'Sí, anular',
        cancelText: 'Cancelar',
        type: 'warning',
        onConfirm: doVoid
    });
}

// ─── Consolidación de deuda ──────────────────────────────────────────────────

export function toggleConsolidateForm() {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.showConsolidateForm = !state.loansLedger.showConsolidateForm;
        if (state.loansLedger.showConsolidateForm) {
            state.loansLedger.showAddForm = false;
            state.loansLedger.showRefinanceFormForLoan = null;
            state.loansLedger.showPaymentFormForLoan = null;
            state.loansLedger.consolidateDraft = {
                installmentCount: 1,
                installmentFrequencyWeeks: Math.round(getCalendarPeriodWeeks(state)) || 2,
                interestRate: 0,
                note: '',
                startDate: getDateKey(new Date()),
                showAdvanced: false
            };
        } else {
            state.loansLedger.consolidateDraft = null;
        }
    });
    render();
}

export function toggleConsolidateAdvancedOptions() {
    ensureLedgerState();
    const draft = state.loansLedger?.consolidateDraft;
    if (draft) {
        draft.showAdvanced = !draft.showAdvanced;
        render();
    }
}

export function setConsolidateDraftField(field, value) {
    ensureLedgerState();
    const draft = state.loansLedger.consolidateDraft;
    if (!draft) return;
    if (field === 'installmentCount' || field === 'installmentFrequencyWeeks' || field === 'interestRate') {
        draft[field] = Number(value) || 0;
    } else {
        draft[field] = value;
    }
    render();
}

export function submitConsolidateLoans() {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    if (!empId) {
        alertMsg('Selecciona un empleado primero');
        return;
    }
    const emp = findScopedLoanEmployee(empId);
    if (!emp) {
        alertMsg('Empleado no disponible en el proyecto activo');
        return;
    }

    const draft = state.loansLedger.consolidateDraft || {};
    try {
        const { consolidatedLoan, closedLoans } = consolidateLoans(emp, {
            installmentCount: Number(draft.installmentCount || 1),
            installmentFrequencyWeeks: Number(draft.installmentFrequencyWeeks || 2),
            interestRate: Number(draft.interestRate || 0),
            startDate: draft.startDate,
            note: draft.note
        }, null, { projectScope: captureEntityProjectScope() });

        stateManager.batchSetState(() => {
            state.loansLedger.showConsolidateForm = false;
            state.loansLedger.consolidateDraft = null;
        });

        saveApplicationData({
            immediate: true,
            announce: `Deuda consolidada: ${closedLoans.length} préstamos unificados en $${consolidatedLoan.principal.toFixed(2)}`
        });
        render();
    } catch (err) {
        alertMsg(`❌ ${err.message}`);
    }
}


export function toggleInactiveHistory() {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.showInactiveHistory = !state.loansLedger.showInactiveHistory;
    });
}

// ─── Duplicate resolution (Fase 2, U5) ───────────────────────────────────────

function _selectedEmployee() {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    return findScopedLoanEmployee(empId) || null;
}

/**
 * "Son distintos, quedan los dos": renumera el perdedor del desempate al
 * siguiente seq disponible. No es destructivo → sin diálogo de confirmación.
 */
export function resolveDupKeepBoth(loanIdA, loanIdB) {
    const emp = _selectedEmployee();
    if (!emp) {
        alertMsg('Empleado no encontrado');
        return;
    }
    try {
        resolveDuplicateAsDistinct(emp, loanIdA, loanIdB);
        saveApplicationData({ immediate: true, announce: 'Duplicado resuelto: son préstamos distintos' });
        render();
    } catch (err) {
        alertMsg(`❌ ${err.message}`);
    }
}

/**
 * "Eliminar este": anula si hace falta y borra con tombstone. DESTRUCTIVO →
 * exige confirmación; sin window.showConfirm disponible NO borra (a
 * diferencia del guard suave de creación, acá el default seguro es no
 * hacer nada).
 */
export function resolveDupDeleteLoan(loanId) {
    const emp = _selectedEmployee();
    if (!emp) {
        alertMsg('Empleado no encontrado');
        return;
    }
    if (typeof window === 'undefined' || typeof window.showConfirm !== 'function') {
        alertMsg('No se pudo abrir el diálogo de confirmación. Intenta de nuevo.');
        return;
    }
    const loan = (emp.loans || []).find(l => l.id === loanId);
    window.showConfirm({
        title: 'Eliminar préstamo duplicado',
        message: `Se anulará y eliminará el préstamo "${escapeHTML(loan?.concept || 'Préstamo')}" ` +
            `(${escapeHTML(loan?.startDate || '')}) de forma permanente. El otro préstamo del par queda intacto. ` +
            `Esta acción se propaga a los demás dispositivos. ¿Continuar?`,
        confirmText: 'Sí, eliminar este',
        cancelText: 'Cancelar',
        type: 'danger',
        onConfirm: () => {
            try {
                resolveDuplicateByDeleting(emp, loanId);
                saveApplicationData({ immediate: true, announce: 'Duplicado eliminado' });
                render();
            } catch (err) {
                alertMsg(`❌ ${err.message}`);
            }
        }
    });
}

/**
 * Alterna el estilo visual del indicador de capacidad de pago
 * entre 'gauge' (Opción B: circular analítico) y 'stacked' (Opción C: barra multicapa).
 */
export function toggleLoansCapacityStyle() {
    const current = (state.settings && state.settings.loansCapacityStyle) || 'gauge';
    const next = current === 'gauge' ? 'stacked' : 'gauge';
    stateManager.batchSetState(s => {
        if (!s.settings) s.settings = {};
        s.settings.loansCapacityStyle = next;
        s.settings.updatedAt = Date.now();
        s.settings._isDirty = true;
    });
    saveApplicationData();
    if (typeof window !== 'undefined' && window.showNotification) {
        window.showNotification(
            next === 'gauge' ? 'Vista de capacidad: Gauge Analítico (Circular)' : 'Vista de capacidad: Barra Multicapa Asistida',
            'info'
        );
    }
    render();
}

/**
 * Asigna explícitamente el estilo visual de capacidad.
 */
export function setLoansCapacityStyle(style) {
    const validStyle = style === 'stacked' ? 'stacked' : 'gauge';
    stateManager.batchSetState(s => {
        if (!s.settings) s.settings = {};
        s.settings.loansCapacityStyle = validStyle;
        s.settings.updatedAt = Date.now();
        s.settings._isDirty = true;
    });
    saveApplicationData();
    render();
}

/**
 * Alterna la densidad de métricas rápidas del empleado
 * entre 'full' (4 tarjetas: completa) y 'compact' (2 tarjetas: minimalista).
 */
export function toggleLoansKpiDensity() {
    const current = (state.settings && state.settings.loansKpiDensity) || 'full';
    const next = current === 'full' ? 'compact' : 'full';
    stateManager.batchSetState(s => {
        if (!s.settings) s.settings = {};
        s.settings.loansKpiDensity = next;
        s.settings.updatedAt = Date.now();
        s.settings._isDirty = true;
    });
    saveApplicationData();
    if (typeof window !== 'undefined' && window.showNotification) {
        window.showNotification(
            next === 'compact' ? 'Métricas: Vista Minimalista (2 tarjetas clave)' : 'Métricas: Vista Completa (4 tarjetas)',
            'info'
        );
    }
    render();
}

/**
 * Asigna explícitamente la densidad de métricas rápidas del empleado.
 */
export function setLoansKpiDensity(density) {
    const validDensity = density === 'compact' ? 'compact' : 'full';
    stateManager.batchSetState(s => {
        if (!s.settings) s.settings = {};
        s.settings.loansKpiDensity = validDensity;
        s.settings.updatedAt = Date.now();
        s.settings._isDirty = true;
    });
    saveApplicationData();
    render();
}

/**
 * Aplica la cantidad de cuotas sugerida por el asistente de viabilidad
 * al borrador del formulario activo (alta, refinanciamiento o consolidación).
 */
export function applySuggestedInstallmentCount(count) {
    const num = parseInt(count, 10);
    if (!num || num <= 0) return;

    const ledger = state.loansLedger || {};
    if (ledger.showConsolidateForm) {
        stateManager.batchSetState(() => {
            if (state.loansLedger?.consolidateDraft) {
                state.loansLedger.consolidateDraft.showAdvanced = true;
            }
        });
        setConsolidateDraftField('installmentCount', num);
    } else if (ledger.refinancingLoanId) {
        setRefinanceDraftField('mode', 'installments');
        setRefinanceDraftField('installmentCount', num);
    } else {
        setLoanDraftField('installmentMode', 'installments');
        setLoanDraftField('installmentCount', num);
    }
}

/**
 * Abre el modal unificado de preferencias de la sección de préstamos.
 */
export function openLoansSettingsModal() {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.showSettingsModal = true;
    });
    render();
}

/**
 * Cierra el modal unificado de preferencias de préstamos.
 */
export function closeLoansSettingsModal() {
    ensureLedgerState();
    stateManager.batchSetState(() => {
        state.loansLedger.showSettingsModal = false;
    });
    render();
}

/**
 * Activa o desactiva una tarjeta de resumen (KPI) en la vista de préstamos.
 * La tarjeta se añade al final de las activas o se retira.
 * Se asegura que al menos una tarjeta permanezca visible.
 */
export function toggleLoansKpiCard(cardId) {
    if (!cardId) return;
    const current = (state.settings && Array.isArray(state.settings.loansKpiCards) && state.settings.loansKpiCards.length > 0)
        ? [...state.settings.loansKpiCards]
        : ((state.settings && state.settings.loansKpiDensity === 'compact') ? ['balance', 'nextDeduction'] : ['balance', 'paid', 'nextDeduction', 'history']);

    const idx = current.indexOf(cardId);
    if (idx >= 0) {
        if (current.length <= 1) {
            if (typeof window !== 'undefined' && window.showNotification) {
                window.showNotification('Debe mantenerse al menos una tarjeta de resumen visible.', 'warning');
            }
            return;
        }
        current.splice(idx, 1);
    } else {
        current.push(cardId);
    }

    stateManager.batchSetState(s => {
        if (!s.settings) s.settings = {};
        s.settings.loansKpiCards = current;
        s.settings.updatedAt = Date.now();
        s.settings._isDirty = true;
    });
    saveApplicationData();
    render();
}

/**
 * Cambia la posición / orden de visualización de una tarjeta activa (arriba o abajo).
 */
export function moveLoansKpiCard(cardId, direction) {
    if (!cardId) return;
    const current = (state.settings && Array.isArray(state.settings.loansKpiCards) && state.settings.loansKpiCards.length > 0)
        ? [...state.settings.loansKpiCards]
        : ((state.settings && state.settings.loansKpiDensity === 'compact') ? ['balance', 'nextDeduction'] : ['balance', 'paid', 'nextDeduction', 'history']);

    const idx = current.indexOf(cardId);
    if (idx < 0) return;

    const offset = (direction === 'up' || direction === -1) ? -1 : 1;
    const targetIdx = idx + offset;
    if (targetIdx < 0 || targetIdx >= current.length) return;

    const tmp = current[idx];
    current[idx] = current[targetIdx];
    current[targetIdx] = tmp;

    stateManager.batchSetState(s => {
        if (!s.settings) s.settings = {};
        s.settings.loansKpiCards = current;
        s.settings.updatedAt = Date.now();
        s.settings._isDirty = true;
    });
    saveApplicationData();
    render();
}

/**
 * Restablece las tarjetas de resumen y el estilo de capacidad a valores de fábrica.
 */
export function resetLoansKpiCards() {
    stateManager.batchSetState(s => {
        if (!s.settings) s.settings = {};
        s.settings.loansKpiCards = ['balance', 'paid', 'nextDeduction', 'history'];
        s.settings.loansCapacityStyle = 'gauge';
        s.settings.loansKpiDensity = 'full';
        s.settings.updatedAt = Date.now();
        s.settings._isDirty = true;
    });
    saveApplicationData();
    if (typeof window !== 'undefined' && window.showNotification) {
        window.showNotification('Preferencias de préstamos restablecidas a valores de fábrica.', 'info');
    }
    render();
}

/**
 * Register handlers on window.* for the data-app-fn dispatcher used by the
 * Ledger UI. Called once at app boot from app.js.
 */
export function registerLegacyGlobals() {
    if (typeof window === 'undefined') return;
    window.selectLoansEmployee = selectLoansEmployee;
    window.clearLoansEmployee = clearLoansEmployee;
    window.setLoansSearch = setLoansSearch;
    window.toggleAddLoanForm = toggleAddLoanForm;
    window.setLoanDraftField = setLoanDraftField;
    window.submitNewLoan = submitNewLoan;
    window.togglePaymentForm = togglePaymentForm;
    window.setPaymentDraftField = setPaymentDraftField;
    window.submitPayment = submitPayment;
    window.settleLoanByFullPayment = settleLoanByFullPayment;
    window.writeOffLoanWithConfirm = writeOffLoanWithConfirm;
    window.reopenLoanHandler = reopenLoanHandler;
    window.deleteLoanWithConfirm = deleteLoanWithConfirm;
    window.voidPaymentHandler = voidPaymentHandler;
    window.openLoansEmployeePicker = openLoansEmployeePicker;
    window.closeLoansEmployeePicker = closeLoansEmployeePicker;
    window.setLoansPickerSearch = setLoansPickerSearch;
    window.openProfileForLoan = openProfileForLoan;
    window.pickEmployeeForNewLoan = pickEmployeeForNewLoan;
    window.openLoansLedgerFor = openLoansLedgerFor;
    window.toggleInactiveHistory = toggleInactiveHistory;
    window.resolveDupKeepBoth = resolveDupKeepBoth;
    window.resolveDupDeleteLoan = resolveDupDeleteLoan;
    window.toggleRefinanceForm = toggleRefinanceForm;
    window.setRefinanceDraftField = setRefinanceDraftField;
    window.submitRefinance = submitRefinance;
    window.voidRefinanceHandler = voidRefinanceHandler;
    window.toggleConsolidateForm = toggleConsolidateForm;
    window.toggleConsolidateAdvancedOptions = toggleConsolidateAdvancedOptions;
    window.setConsolidateDraftField = setConsolidateDraftField;
    window.submitConsolidateLoans = submitConsolidateLoans;
    window.setLoansFilterView = setLoansFilterView;
    window.setLoansSortBy = setLoansSortBy;
    window.setLoansSortOrder = setLoansSortOrder;
    window.setLoansAmountFilter = setLoansAmountFilter;
    window.setLoansDateFilter = setLoansDateFilter;
    window.toggleLoansFilterMenu = toggleLoansFilterMenu;
    window.resetLoansFilters = resetLoansFilters;
    window.setLoansDisplayMode = setLoansDisplayMode;
    window.toggleLoansCapacityStyle = toggleLoansCapacityStyle;
    window.setLoansCapacityStyle = setLoansCapacityStyle;
    window.toggleLoansKpiDensity = toggleLoansKpiDensity;
    window.setLoansKpiDensity = setLoansKpiDensity;
    window.applySuggestedInstallmentCount = applySuggestedInstallmentCount;
    window.openLoansSettingsModal = openLoansSettingsModal;
    window.closeLoansSettingsModal = closeLoansSettingsModal;
    window.toggleLoansKpiCard = toggleLoansKpiCard;
    window.moveLoansKpiCard = moveLoansKpiCard;
    window.resetLoansKpiCards = resetLoansKpiCards;
    // Exposed so ProfileController.closeEmployeeProfile can pull freshly-
    // added legacy advances into emp.loans[] without an import cycle.
    window.migrateAllAdvances = migrateAllAdvances;
}
