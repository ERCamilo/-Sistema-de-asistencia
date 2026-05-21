/**
 * 💵 LoansLedger — Template for the Cuentas-por-Cobrar view.
 *
 * Two modes:
 *  - LIST: top stats + filter + table of employees with active loans
 *  - DETAIL: drilldown for one employee showing every loan + payments
 *
 * Mode switches via state.loansLedger.selectedEmployeeId (null = list).
 *
 * All buttons go through data-app-fn; handlers live in LoansController.js
 * and are bound to window.* at boot via registerLegacyGlobals().
 */

import { state } from '../../core/AppState.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { formatDateShort } from '../../utils/DateUtils.js';
import icons from '../../ui/IconSystem.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import {
    getEmployeesWithDebt,
    getTotalExposure,
    getBalance,
    getTotalDue,
    getPaidAmount,
    LOAN_STATUS,
    INSTALLMENT_MODE,
    VALIDATION,
    generateInstallmentSchedule
} from './LoansService.js';

export function LoansLedger() {
    const ledger = state.loansLedger || {};
    const body = ledger.selectedEmployeeId
        ? EmployeeLoansDetail(ledger.selectedEmployeeId)
        : LedgerOverview();
    // The picker is an overlay that can appear over either mode.
    return body + (ledger.showEmployeePicker ? EmployeePickerOverlay() : '');
}

// ─── LIST VIEW ───────────────────────────────────────────────────────────────

function LedgerOverview() {
    const ledger = state.loansLedger || {};
    const search = (ledger.search || '').toLowerCase().trim();

    const allWithDebt = getEmployeesWithDebt(state);
    const filtered = search
        ? allWithDebt.filter(e =>
            (e.name || '').toLowerCase().includes(search) ||
            (e.number || '').toLowerCase().includes(search))
        : allWithDebt;

    const totalExposure = getTotalExposure(state);
    const totalLoans = allWithDebt.reduce((s, e) => s + e.loanCount, 0);

    return `
        <div style="max-width: 1000px; margin: 0 auto;">
            <!-- KPI cards -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 20px;">
                ${kpiCard('Saldo total pendiente', formatCurrency(totalExposure), '#f59e0b', 'payroll')}
                ${kpiCard('Empleados con deuda', allWithDebt.length.toString(), '#06b6d4', 'personnel')}
                ${kpiCard('Préstamos activos', totalLoans.toString(), '#10b981', 'briefcase')}
            </div>

            <!-- Search + actions -->
            <div style="background: #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 20px; border: 1px solid #334155; display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
                <div style="flex: 1; min-width: 220px;">
                    <input type="text" autocomplete="off"
                           placeholder="🔍 Buscar empleado por nombre o número..."
                           value="${escapeAttr(ledger.search || '')}"
                           oninput="setLoansSearch(this.value)"
                           style="width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <button type="button" data-app-fn="openLoansEmployeePicker"
                        style="padding: 10px 16px; background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #000; border: none; border-radius: 8px; font-weight: 800; font-size: 0.85rem; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;">
                    ${icons.get('add', { size: 16 })} Agregar nuevo
                </button>
                <div style="font-size: 0.8rem; color: #94a3b8;">
                    Mostrando ${filtered.length} de ${allWithDebt.length}
                </div>
            </div>

            <!-- Employee list -->
            ${filtered.length === 0 ? `
                <div style="text-align: center; padding: 60px 20px; background: #1e293b; border-radius: 12px; border: 1px solid #334155;">
                    <div style="font-size: 3rem; margin-bottom: 12px; opacity: 0.4;">${icons.get('payroll')}</div>
                    <div style="color: #94a3b8; font-size: 0.95rem;">
                        ${search ? 'No se encontraron empleados que coincidan con la búsqueda' : 'No hay empleados con préstamos activos'}
                    </div>
                </div>
            ` : filtered.map(emp => `
                <div role="button" tabindex="0"
                     data-app-fn="selectLoansEmployee" data-arg="${emp.employeeId}"
                     style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px 18px; margin-bottom: 10px; cursor: pointer; transition: all 0.15s;"
                     onmouseover="this.style.borderColor='#06b6d4'"
                     onmouseout="this.style.borderColor='#334155'">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 200px;">
                            <div style="width: 44px; height: 44px; background: rgba(245,158,11,0.12); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #f59e0b; font-weight: 800;">
                                ${emp.number || '?'}
                            </div>
                            <div>
                                <div style="color: #f1f5f9; font-weight: 700; font-size: 0.95rem;">${escapeHTML(emp.name)}</div>
                                <div style="color: #94a3b8; font-size: 0.75rem; margin-top: 2px;">
                                    ${emp.loanCount} préstamo${emp.loanCount === 1 ? '' : 's'} activo${emp.loanCount === 1 ? '' : 's'}
                                </div>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Saldo</div>
                            <div style="font-size: 1.25rem; font-weight: 900; color: #f59e0b;">${formatCurrency(emp.totalBalance)}</div>
                            <div style="font-size: 0.7rem; color: #64748b; margin-top: 2px;">
                                Total: ${formatCurrency(emp.totalDue)} · Pagado: ${formatCurrency(emp.totalPaid)}
                            </div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function kpiCard(label, value, color, iconName) {
    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 16px; border: 1px solid #334155; border-left: 4px solid ${color};">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <div style="color: ${color};">${icons.get(iconName, { size: 18 })}</div>
                <div style="font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em;">${label}</div>
            </div>
            <div style="font-size: 1.5rem; font-weight: 900; color: #f1f5f9;">${value}</div>
        </div>
    `;
}

// ─── DETAIL VIEW (one employee) ──────────────────────────────────────────────

function EmployeeLoansDetail(empId) {
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) {
        return `
            <div style="text-align: center; padding: 60px 20px;">
                <div style="color: #94a3b8;">Empleado no encontrado</div>
                <button data-app-fn="clearLoansEmployee" style="margin-top: 12px; padding: 8px 16px; background: #06b6d4; color: #000; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">← Volver</button>
            </div>
        `;
    }

    const allLoans = emp.loans || [];
    const active = allLoans.filter(l => l.status === LOAN_STATUS.ACTIVE);
    const paid = allLoans.filter(l => l.status === LOAN_STATUS.PAID);
    const writtenOff = allLoans.filter(l => l.status === LOAN_STATUS.WRITTEN_OFF);
    const totalBalance = active.reduce((s, l) => s + getBalance(l), 0);

    const ledger = state.loansLedger || {};
    const showAddForm = !!ledger.showAddForm;

    return `
        <div style="max-width: 1000px; margin: 0 auto;">
            <!-- Header with back button -->
            <div style="background: #1e293b; border-radius: 12px; padding: 16px 18px; border: 1px solid #334155; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <button type="button" data-app-fn="clearLoansEmployee" aria-label="Volver"
                            style="width: 36px; height: 36px; background: transparent; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; cursor: pointer; font-size: 1.1rem;">←</button>
                    <div>
                        <div style="color: #f1f5f9; font-weight: 800; font-size: 1.1rem;">${escapeHTML(emp.name)}</div>
                        <div style="color: #94a3b8; font-size: 0.8rem;">#${emp.number}</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Saldo pendiente</div>
                    <div style="font-size: 1.5rem; font-weight: 900; color: #f59e0b;">${formatCurrency(totalBalance)}</div>
                </div>
            </div>

            <!-- New loan button / form -->
            ${showAddForm ? NewLoanForm() : `
                <button type="button" data-app-fn="toggleAddLoanForm"
                        style="width: 100%; padding: 14px; margin-bottom: 16px; background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #000; border: none; border-radius: 10px; font-weight: 800; font-size: 0.95rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;">
                    ${icons.get('add')} Nuevo préstamo / adelanto
                </button>
            `}

            <!-- Active loans -->
            ${active.length > 0 ? `
                <div style="font-size: 0.8rem; font-weight: 700; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Activos (${active.length})</div>
                ${active.map(loan => LoanCard(loan)).join('')}
            ` : ''}

            <!-- Paid loans -->
            ${paid.length > 0 ? `
                <details style="margin-top: 20px;">
                    <summary style="cursor: pointer; font-size: 0.8rem; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 0;">
                        Saldados (${paid.length}) ▾
                    </summary>
                    ${paid.map(loan => LoanCard(loan)).join('')}
                </details>
            ` : ''}

            <!-- Written-off loans -->
            ${writtenOff.length > 0 ? `
                <details style="margin-top: 12px;">
                    <summary style="cursor: pointer; font-size: 0.8rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 0;">
                        Anulados (${writtenOff.length}) ▾
                    </summary>
                    ${writtenOff.map(loan => LoanCard(loan)).join('')}
                </details>
            ` : ''}

            ${allLoans.length === 0 ? `
                <div style="text-align: center; padding: 40px 20px; color: #64748b; background: #1e293b; border-radius: 12px; border: 1px dashed #334155;">
                    Este empleado no tiene préstamos registrados. Usa el botón arriba para crear el primero.
                </div>
            ` : ''}
        </div>
    `;
}

// ─── ONE LOAN CARD ───────────────────────────────────────────────────────────

function LoanCard(loan) {
    const balance = getBalance(loan);
    const totalDue = getTotalDue(loan);
    const paid = getPaidAmount(loan);
    const isActive = loan.status === LOAN_STATUS.ACTIVE;
    const isWrittenOff = loan.status === LOAN_STATUS.WRITTEN_OFF;
    const ledger = state.loansLedger || {};
    const showPay = ledger.showPaymentFormForLoan === loan.id;
    const visiblePayments = (loan.payments || []).filter(p => !p.voided);

    const statusBadge = isActive
        ? `<span style="background: #f59e0b; color: #000; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800;">ACTIVO</span>`
        : loan.status === LOAN_STATUS.PAID
            ? `<span style="background: #10b981; color: #000; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800;">SALDADO</span>`
            : `<span style="background: #64748b; color: #fff; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800;">ANULADO</span>`;

    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 16px 18px; border: 1px solid #334155; margin-bottom: 12px; ${isWrittenOff ? 'opacity: 0.6;' : ''}">
            <!-- Top line: concept + status -->
            <div style="display: flex; justify-content: space-between; align-items: start; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px;">
                    <div style="font-size: 0.95rem; font-weight: 700; color: #f1f5f9; margin-bottom: 4px;">${escapeHTML(loan.concept || 'Préstamo')}</div>
                    <div style="font-size: 0.75rem; color: #94a3b8;">
                        ${formatDateShort(loan.startDate)} ·
                        ${loan.installmentMode === INSTALLMENT_MODE.INSTALLMENTS ? `${(loan.installments || []).length} cuotas` : 'Pago único'}
                    </div>
                </div>
                ${statusBadge}
            </div>

            <!-- Numbers row -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; padding: 12px; background: #0f172a; border-radius: 8px; margin-bottom: 12px;">
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Capital</div>
                    <div style="font-size: 0.95rem; color: #f1f5f9; font-weight: 700;">${formatCurrency(loan.principal)}</div>
                </div>
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Interés</div>
                    <div style="font-size: 0.95rem; color: #f1f5f9; font-weight: 700;">${loan.interestRate}%${loan.interestIncluded ? ' (incl.)' : ''}</div>
                </div>
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Total</div>
                    <div style="font-size: 0.95rem; color: #f1f5f9; font-weight: 700;">${formatCurrency(totalDue)}</div>
                </div>
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Pagado</div>
                    <div style="font-size: 0.95rem; color: #10b981; font-weight: 700;">${formatCurrency(paid)}</div>
                </div>
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Saldo</div>
                    <div style="font-size: 0.95rem; color: ${balance > 0 ? '#f59e0b' : '#10b981'}; font-weight: 800;">${formatCurrency(balance)}</div>
                </div>
            </div>

            <!-- Payments history -->
            ${visiblePayments.length > 0 ? `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-bottom: 6px;">Abonos</div>
                    ${visiblePayments.slice().reverse().map(p => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: #0f172a; border-radius: 6px; margin-bottom: 4px; font-size: 0.8rem;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span style="color: #10b981; font-weight: 700;">+${formatCurrency(p.amount)}</span>
                                <span style="color: #94a3b8;">${formatDateShort(p.date)}</span>
                                ${p.note ? `<span style="color: #64748b; font-style: italic;">"${escapeHTML(p.note)}"</span>` : ''}
                            </div>
                            ${isActive ? `<button type="button" data-app-fn="voidPaymentHandler" data-arg="${loan.id}" data-arg2="${p.id}"
                                                  style="background: transparent; border: 1px solid #334155; color: #94a3b8; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; cursor: pointer;"
                                                  title="Anular este abono">✕</button>` : ''}
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <!-- Payment form -->
            ${isActive && showPay ? PaymentForm(loan, balance) : ''}

            <!-- Actions -->
            ${isActive ? `
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${!showPay ? `
                        <button type="button" data-app-fn="togglePaymentForm" data-arg="${loan.id}"
                                style="flex: 1; min-width: 130px; padding: 10px 14px; background: #06b6d4; color: #000; border: none; border-radius: 8px; font-weight: 800; font-size: 0.85rem; cursor: pointer;">
                            ${icons.get('add', { size: 14 })} Registrar abono
                        </button>
                    ` : ''}
                    <button type="button" data-app-fn="settleLoanByFullPayment" data-arg="${loan.id}"
                            style="padding: 10px 14px; background: #10b981; color: #000; border: none; border-radius: 8px; font-weight: 800; font-size: 0.85rem; cursor: pointer;">
                        ${icons.get('check', { size: 14 })} Saldar
                    </button>
                    <button type="button" data-app-fn="writeOffLoanWithConfirm" data-arg="${loan.id}"
                            style="padding: 10px 14px; background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 8px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
                        ${icons.get('delete', { size: 14 })}
                    </button>
                </div>
            ` : isWrittenOff ? `
                <button type="button" data-app-fn="reopenLoanHandler" data-arg="${loan.id}"
                        style="padding: 8px 14px; background: transparent; color: #06b6d4; border: 1px solid #06b6d4; border-radius: 8px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
                    Reactivar
                </button>
            ` : ''}
        </div>
    `;
}

// ─── PAYMENT (abono) FORM ────────────────────────────────────────────────────

function PaymentForm(loan, balance) {
    const draft = (state.loansLedger || {}).paymentDraft || { amount: 0, date: '', note: '' };
    return `
        <div style="background: rgba(6,182,212,0.08); border: 1px solid rgba(6,182,212,0.3); border-radius: 10px; padding: 12px; margin-bottom: 12px;">
            <div style="font-size: 0.75rem; color: #06b6d4; font-weight: 800; text-transform: uppercase; margin-bottom: 10px;">Nuevo abono</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px;">
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Monto (saldo: ${formatCurrency(balance)})</label>
                    <input type="number" inputmode="decimal" autocomplete="off"
                           value="${draft.amount || ''}" max="${balance}" min="0" step="0.01"
                           oninput="setPaymentDraftField('amount', this.value)"
                           placeholder="0.00"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Fecha</label>
                    <input type="date" value="${draft.date}"
                           onchange="setPaymentDraftField('date', this.value)"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Concepto</label>
                    <input type="text" value="${escapeAttr(draft.note || '')}"
                           oninput="setPaymentDraftField('note', this.value)"
                           placeholder="opcional"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button type="button" data-app-fn="submitPayment" data-arg="${loan.id}"
                        style="flex: 1; padding: 10px; background: #06b6d4; color: #000; border: none; border-radius: 6px; font-weight: 800; font-size: 0.85rem; cursor: pointer;">
                    Guardar abono
                </button>
                <button type="button" data-app-fn="togglePaymentForm" data-arg="${loan.id}"
                        style="padding: 10px 14px; background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 6px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

// ─── NEW LOAN FORM ───────────────────────────────────────────────────────────

// ─── EMPLOYEE PICKER OVERLAY ─────────────────────────────────────────────────
//
// Shown when the user taps "+ Agregar nuevo" on the overview. Lists every
// active employee with a quick filter; tapping a row closes the picker and
// opens that employee's profile on the Nómina tab so the loan can be
// registered through the in-profile editor.

function EmployeePickerOverlay() {
    const ledger = state.loansLedger || {};
    const search = (ledger.pickerSearch || '').toLowerCase().trim();
    const all = (state.employees || []).filter(e => e.active !== false);
    const filtered = search
        ? all.filter(e =>
            (e.name || '').toLowerCase().includes(search) ||
            (e.number || '').toLowerCase().includes(search))
        : all;

    return `
        <div role="dialog" aria-modal="true"
             style="position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 9000; display: flex; align-items: center; justify-content: center; padding: 16px;"
             onclick="if(event.target===this) closeLoansEmployeePicker()">
            <div style="background: #1e293b; border: 1px solid #334155; border-radius: 14px; width: 100%; max-width: 520px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden;">
                <div style="padding: 16px 18px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <div>
                        <div style="color: #f1f5f9; font-weight: 800; font-size: 1rem;">Selecciona un empleado</div>
                        <div style="color: #94a3b8; font-size: 0.78rem; margin-top: 2px;">Te llevaremos a su perfil para registrar el préstamo</div>
                    </div>
                    <button type="button" data-app-fn="closeLoansEmployeePicker" aria-label="Cerrar"
                            style="width: 32px; height: 32px; background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 8px; cursor: pointer; font-size: 1rem;">✕</button>
                </div>
                <div style="padding: 12px 16px; border-bottom: 1px solid #334155;">
                    <input type="text" autocomplete="off"
                           placeholder="🔍 Buscar empleado..."
                           value="${escapeAttr(ledger.pickerSearch || '')}"
                           oninput="setLoansPickerSearch(this.value)"
                           style="width: 100%; padding: 10px 12px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div style="overflow-y: auto; padding: 8px;">
                    ${filtered.length === 0 ? `
                        <div style="text-align: center; padding: 40px 20px; color: #64748b; font-size: 0.9rem;">
                            ${search ? 'No se encontraron empleados' : 'No hay empleados activos'}
                        </div>
                    ` : filtered.map(emp => `
                        <div role="button" tabindex="0"
                             data-app-fn="openProfileForLoan" data-arg="${emp.id}"
                             style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; cursor: pointer; transition: background 0.12s;"
                             onmouseover="this.style.background='#0f172a'"
                             onmouseout="this.style.background='transparent'">
                            <div style="width: 36px; height: 36px; background: rgba(6,182,212,0.12); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #06b6d4; font-weight: 800; font-size: 0.85rem;">
                                ${emp.number || '?'}
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <div style="color: #f1f5f9; font-weight: 700; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(emp.name)}</div>
                                <div style="color: #94a3b8; font-size: 0.72rem;">${(emp.loans || []).filter(l => l.status === LOAN_STATUS.ACTIVE).length} préstamo(s) activo(s)</div>
                            </div>
                            <div style="color: #64748b; font-size: 1.1rem;">›</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function NewLoanForm() {
    const draft = (state.loansLedger || {}).newLoanDraft || {};
    const isInstallments = draft.installmentMode === INSTALLMENT_MODE.INSTALLMENTS;

    // Preview installment schedule live as the user types
    let schedulePreview = '';
    if (isInstallments && draft.principal > 0 && draft.installmentCount >= 2 && draft.startDate) {
        try {
            const schedule = generateInstallmentSchedule({
                principal: Number(draft.principal),
                interestRate: Number(draft.interestRate || 0),
                interestIncluded: !!draft.interestIncluded,
                startDate: draft.startDate,
                count: Number(draft.installmentCount),
                frequencyWeeks: Number(draft.installmentFrequencyWeeks)
            });
            schedulePreview = `
                <div style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; margin-top: 10px;">
                    <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-bottom: 6px;">Plan de cuotas (vista previa)</div>
                    ${schedule.map(inst => `
                        <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <span style="color: #94a3b8;">Cuota ${inst.seq} · ${formatDateShort(inst.dueDate)}</span>
                            <span style="color: #f1f5f9; font-weight: 700;">${formatCurrency(inst.scheduledAmount)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch { /* draft invalid, no preview */ }
    }

    return `
        <div style="background: #1e293b; border: 1px solid #06b6d4; border-radius: 12px; padding: 18px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <div style="font-size: 0.9rem; font-weight: 800; color: #06b6d4; text-transform: uppercase; letter-spacing: 0.05em;">Nuevo Préstamo</div>
                <button type="button" data-app-fn="toggleAddLoanForm"
                        style="background: transparent; color: #94a3b8; border: 1px solid #334155; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">✕ Cerrar</button>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Monto del capital</label>
                    <input type="number" inputmode="decimal" autocomplete="off"
                           value="${draft.principal || ''}" min="0" step="0.01"
                           oninput="setLoanDraftField('principal', this.value)"
                           placeholder="0.00"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Interés (%) <small style="color:#64748b;">max ${VALIDATION.MAX_INTEREST_PERCENT}</small></label>
                    <input type="number" inputmode="decimal" autocomplete="off"
                           value="${draft.interestRate || 0}" min="0" max="${VALIDATION.MAX_INTEREST_PERCENT}" step="0.1"
                           oninput="setLoanDraftField('interestRate', this.value)"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Fecha</label>
                    <input type="date" value="${draft.startDate}"
                           onchange="setLoanDraftField('startDate', this.value)"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div style="grid-column: 1 / -1;">
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Concepto</label>
                    <input type="text" autocomplete="off"
                           value="${escapeAttr(draft.concept || '')}"
                           oninput="setLoanDraftField('concept', this.value)"
                           placeholder="Ej: Adelanto de quincena, préstamo médico, etc."
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
            </div>

            <!-- Mode toggle -->
            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                <button type="button" onclick="setLoanDraftField('installmentMode', 'lump'); document.dispatchEvent(new Event('click'))"
                        style="flex: 1; padding: 8px; background: ${!isInstallments ? '#06b6d4' : '#0f172a'}; color: ${!isInstallments ? '#000' : '#94a3b8'}; border: 1px solid ${!isInstallments ? '#06b6d4' : '#334155'}; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
                    Pago único
                </button>
                <button type="button" onclick="setLoanDraftField('installmentMode', 'installments'); document.dispatchEvent(new Event('click'))"
                        style="flex: 1; padding: 8px; background: ${isInstallments ? '#06b6d4' : '#0f172a'}; color: ${isInstallments ? '#000' : '#94a3b8'}; border: 1px solid ${isInstallments ? '#06b6d4' : '#334155'}; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
                    Cuotas
                </button>
            </div>

            ${isInstallments ? `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Número de cuotas</label>
                        <input type="number" inputmode="numeric" autocomplete="off"
                               value="${draft.installmentCount || 4}" min="2" max="${VALIDATION.MAX_INSTALLMENTS}" step="1"
                               oninput="setLoanDraftField('installmentCount', this.value)"
                               style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                    </div>
                    <div>
                        <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Cada cuántas semanas</label>
                        <select onchange="setLoanDraftField('installmentFrequencyWeeks', this.value)"
                                style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                            ${VALIDATION.ALLOWED_FREQUENCY_WEEKS.map(w =>
                                `<option value="${w}" ${Number(draft.installmentFrequencyWeeks) === w ? 'selected' : ''}>${w} semana${w === 1 ? '' : 's'}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
                ${schedulePreview}
            ` : ''}

            <button type="button" data-app-fn="submitNewLoan"
                    style="width: 100%; margin-top: 12px; padding: 12px; background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #000; border: none; border-radius: 8px; font-weight: 800; font-size: 0.95rem; cursor: pointer;">
                ${icons.get('save', { size: 16 })} Registrar préstamo
            </button>
        </div>
    `;
}
