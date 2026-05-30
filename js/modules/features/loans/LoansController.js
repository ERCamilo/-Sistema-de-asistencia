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

import { state } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { getDateKey } from '../../utils/DateUtils.js';
import {
    createLoan,
    recordPayment,
    voidPayment,
    writeOffLoan,
    reopenLoan,
    refinanceLoan,
    migrateAdvancesToLoans,
    getBalance,
    LOAN_STATUS,
    INSTALLMENT_MODE,
    VALIDATION
} from './LoansService.js';

// ─── State scaffolding ───────────────────────────────────────────────────────

function ensureLedgerState() {
    if (!state.loansLedger) {
        state.loansLedger = {
            selectedEmployeeId: null,
            search: '',
            showAddForm: false,
            newLoanDraft: createEmptyLoanDraft(),
            showPaymentFormForLoan: null,
            paymentDraft: { amount: 0, date: getDateKey(new Date()), note: '' },
            showEmployeePicker: false,
            pickerSearch: '',
            showInactiveHistory: false,
            showRefinanceFormForLoan: null,
            refinanceDraft: createEmptyRefinanceDraft()
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
    }
}

function createEmptyRefinanceDraft() {
    return { basis: 'balance', interestRate: 0, note: '' };
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

// ─── One-time migration on app boot ──────────────────────────────────────────

/**
 * Migrate the legacy emp.advances[] arrays to emp.loans[] for every employee.
 * Idempotent — safe to run on every boot. Called from app.js after data load.
 */
export function migrateAllAdvances() {
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
    state.loansLedger.selectedEmployeeId = employeeId;
    state.loansLedger.showAddForm = false;
    state.loansLedger.showPaymentFormForLoan = null;
    render();
}

export function clearLoansEmployee() {
    ensureLedgerState();
    state.loansLedger.selectedEmployeeId = null;
    state.loansLedger.showAddForm = false;
    state.loansLedger.showPaymentFormForLoan = null;
    render();
}

export function setLoansSearch(value) {
    ensureLedgerState();
    state.loansLedger.search = String(value || '');
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
    state.loansLedger.showEmployeePicker = true;
    state.loansLedger.pickerSearch = '';
    render();
}

export function closeLoansEmployeePicker() {
    ensureLedgerState();
    state.loansLedger.showEmployeePicker = false;
    render();
}

export function setLoansPickerSearch(value) {
    ensureLedgerState();
    state.loansLedger.pickerSearch = String(value || '');
    render();
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
    if (!employeeId) return;
    ensureLedgerState();

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

    // 4. Navegar a la vista de Cuentas por Cobrar (defensivo).
    if (typeof window !== 'undefined' && typeof window.openCuentasPorCobrar === 'function') {
        window.openCuentasPorCobrar();
    } else {
        // Si la función de navegación no existe (tests, ruta no inicializada),
        // al menos disparamos un render para que la UI refleje el cambio.
        render();
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
    if (!employeeId) return;
    ensureLedgerState();
    state.loansLedger.showEmployeePicker = false;
    state.loansLedger.selectedEmployeeId = employeeId;
    state.loansLedger.showPaymentFormForLoan = null;
    state.loansLedger.showAddForm = true;
    state.loansLedger.newLoanDraft = createEmptyLoanDraft();
    render();
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
    state.loansLedger.showAddForm = !state.loansLedger.showAddForm;
    if (state.loansLedger.showAddForm) {
        state.loansLedger.newLoanDraft = createEmptyLoanDraft();
    }
    render();
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
    // Re-render so the installment preview updates if any field changes
    if (draft.installmentMode === INSTALLMENT_MODE.INSTALLMENTS) render();
}

export function submitNewLoan() {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    if (!empId) {
        alertMsg('Selecciona un empleado primero');
        return;
    }
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) {
        alertMsg('Empleado no encontrado');
        return;
    }

    const draft = state.loansLedger.newLoanDraft;
    try {
        const loan = createLoan(emp, draft);
        state.loansLedger.showAddForm = false;
        state.loansLedger.newLoanDraft = createEmptyLoanDraft();
        saveApplicationData({ immediate: true });
        notify(`✅ Préstamo registrado: ${loan.concept}`, 'success');
        render();
    } catch (err) {
        alertMsg(`❌ ${err.message}`);
    }
}

// ─── Payment (abono) form ────────────────────────────────────────────────────

export function togglePaymentForm(loanId) {
    ensureLedgerState();
    state.loansLedger.showPaymentFormForLoan = state.loansLedger.showPaymentFormForLoan === loanId
        ? null
        : loanId;
    state.loansLedger.paymentDraft = {
        amount: 0,
        date: getDateKey(new Date()),
        note: ''
    };
    render();
}

export function setPaymentDraftField(field, value) {
    ensureLedgerState();
    const draft = state.loansLedger.paymentDraft;
    if (!draft) return;
    if (field === 'amount') {
        draft.amount = Number(value) || 0;
    } else {
        draft[field] = value;
    }
}

export function submitPayment(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) {
        alertMsg('Empleado no encontrado');
        return;
    }
    try {
        const payment = recordPayment(emp, loanId, state.loansLedger.paymentDraft);
        state.loansLedger.showPaymentFormForLoan = null;
        saveApplicationData({ immediate: true });
        notify(`✅ Abono registrado: ${payment.amount.toFixed(2)}`, 'success');
        render();
    } catch (err) {
        alertMsg(`❌ ${err.message}`);
    }
}

// ─── Loan operations ─────────────────────────────────────────────────────────

export function settleLoanByFullPayment(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return;
    const loan = (emp.loans || []).find(l => l.id === loanId);
    if (!loan) return;

    const balance = getBalance(loan);
    if (balance <= 0) {
        notify('Este préstamo ya está saldado', 'info');
        return;
    }
    if (!window.showConfirm) {
        // Fallback if Modal.confirm shim is unavailable
        recordPayment(emp, loanId, { amount: balance, date: getDateKey(new Date()), note: 'Saldo completo' });
        saveApplicationData({ immediate: true });
        render();
        return;
    }
    window.showConfirm({
        title: 'Saldar préstamo',
        message: `¿Registrar un abono final de ${balance.toFixed(2)} para saldar este préstamo?`,
        confirmText: 'Sí, saldar',
        cancelText: 'Cancelar',
        type: 'info',
        onConfirm: () => {
            try {
                recordPayment(emp, loanId, { amount: balance, date: getDateKey(new Date()), note: 'Saldo completo' });
                saveApplicationData({ immediate: true });
                notify('✅ Préstamo saldado', 'success');
                render();
            } catch (err) {
                alertMsg(`❌ ${err.message}`);
            }
        }
    });
}

export function writeOffLoanWithConfirm(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return;

    if (!window.showConfirm) {
        writeOffLoan(emp, loanId);
        saveApplicationData({ immediate: true });
        render();
        return;
    }
    window.showConfirm({
        title: 'Eliminar préstamo',
        message: 'El préstamo se marcará como anulado. El historial se conserva pero no aparecerá en el resumen de saldos. ¿Continuar?',
        confirmText: 'Sí, anular',
        cancelText: 'Cancelar',
        type: 'warning',
        onConfirm: () => {
            writeOffLoan(emp, loanId);
            saveApplicationData({ immediate: true });
            notify('Préstamo anulado', 'info');
            render();
        }
    });
}

export function reopenLoanHandler(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return;
    reopenLoan(emp, loanId);
    saveApplicationData({ immediate: true });
    notify('Préstamo reactivado', 'info');
    render();
}

export function voidPaymentHandler(loanId, paymentId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return;

    if (!window.showConfirm) {
        voidPayment(emp, loanId, paymentId);
        saveApplicationData({ immediate: true });
        render();
        return;
    }
    window.showConfirm({
        title: 'Anular abono',
        message: 'El abono se marcará como anulado y el saldo se recalculará. ¿Continuar?',
        confirmText: 'Sí, anular',
        cancelText: 'Cancelar',
        type: 'warning',
        onConfirm: () => {
            voidPayment(emp, loanId, paymentId);
            saveApplicationData({ immediate: true });
            notify('Abono anulado', 'info');
            render();
        }
    });
}

// ─── Refinanciamiento ─────────────────────────────────────────────────────────

export function toggleRefinanceForm(loanId) {
    ensureLedgerState();
    const open = state.loansLedger.showRefinanceFormForLoan === loanId ? null : loanId;
    state.loansLedger.showRefinanceFormForLoan = open;
    // Pre-llenar la tasa con la del préstamo (editable).
    let rate = 0;
    if (open) {
        const emp = state.employees.find(e => e.id === state.loansLedger.selectedEmployeeId);
        const loan = (emp?.loans || []).find(l => l.id === loanId);
        rate = Number(loan?.interestRate || 0);
    }
    state.loansLedger.refinanceDraft = { basis: 'balance', interestRate: rate, note: '' };
    render();
}

export function setRefinanceDraftField(field, value) {
    ensureLedgerState();
    const draft = state.loansLedger.refinanceDraft;
    if (!draft) return;
    if (field === 'interestRate') {
        draft.interestRate = Number(value) || 0;
    } else {
        draft[field] = value;
    }
    // Re-render para actualizar el preview del interés a agregar.
    render();
}

export function submitRefinance(loanId) {
    ensureLedgerState();
    const empId = state.loansLedger.selectedEmployeeId;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) {
        alertMsg('Empleado no encontrado');
        return;
    }
    try {
        const ev = refinanceLoan(emp, loanId, state.loansLedger.refinanceDraft);
        state.loansLedger.showRefinanceFormForLoan = null;
        saveApplicationData({ immediate: true });
        notify(`♻️ Préstamo refinanciado: +${ev.interestAmount.toFixed(2)} de interés`, 'success');
        render();
    } catch (err) {
        alertMsg(`❌ ${err.message}`);
    }
}

export function toggleInactiveHistory() {
    ensureLedgerState();
    state.loansLedger.showInactiveHistory = !state.loansLedger.showInactiveHistory;
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
    window.voidPaymentHandler = voidPaymentHandler;
    window.openLoansEmployeePicker = openLoansEmployeePicker;
    window.closeLoansEmployeePicker = closeLoansEmployeePicker;
    window.setLoansPickerSearch = setLoansPickerSearch;
    window.openProfileForLoan = openProfileForLoan;
    window.pickEmployeeForNewLoan = pickEmployeeForNewLoan;
    window.openLoansLedgerFor = openLoansLedgerFor;
    window.toggleInactiveHistory = toggleInactiveHistory;
    window.toggleRefinanceForm = toggleRefinanceForm;
    window.setRefinanceDraftField = setRefinanceDraftField;
    window.submitRefinance = submitRefinance;
    // Exposed so ProfileController.closeEmployeeProfile can pull freshly-
    // added legacy advances into emp.loans[] without an import cycle.
    window.migrateAllAdvances = migrateAllAdvances;
}
