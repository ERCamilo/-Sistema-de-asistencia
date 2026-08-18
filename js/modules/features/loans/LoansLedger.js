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
import { formatTimeSince } from '../../utils/RelativeTime.js';
import icons from '../../ui/IconSystem.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import {
    getEmployeesWithDebt,
    getTotalExposure,
    getTotalPaidActive,
    getEmployeesWithOnlyInactiveLoans,
    getTotalActiveInterest,
    getTotalHistoricalInterest,
    getTotalHistoricalDue,
    getTotalHistoricalPaid,
    getClosedLoansCount,
    getBalance,
    getTotalDue,
    getPaidAmount,
    getPayrollDeductionOptions,
    getRefinanceCount,
    getActiveLoanTerms,
    getTotalInterestAccrued,
    LOAN_STATUS,
    INSTALLMENT_MODE,
    VALIDATION,
    generateInstallmentSchedule
} from './LoansService.js';
import { detectLoanDuplicateCandidates } from './LoanDuplicateDetector.js';
import { isPendingUpload } from '../../services/EntitiesSyncStamp.js';
import {
    getInstallmentPaymentChoices,
    resolveLoanPaymentDraft,
    PAYMENT_PLAN_MODE
} from './LoanPaymentPlan.js';

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
    const inactiveWithDebt = allWithDebt.filter(employee => employee.active === false);
    const filtered = search
        ? allWithDebt.filter(e =>
            (e.name || '').toLowerCase().includes(search) ||
            (e.number || '').toLowerCase().includes(search))
        : allWithDebt;

    const allInactive = getEmployeesWithOnlyInactiveLoans(state);
    const filteredInactive = search
        ? allInactive.filter(e =>
            (e.name || '').toLowerCase().includes(search) ||
            (e.number || '').toLowerCase().includes(search))
        : allInactive;

    const totalExposure = getTotalExposure(state);
    const totalPaid = getTotalPaidActive(state);
    const totalLoans = allWithDebt.reduce((s, e) => s + e.loanCount, 0);

    const totalActiveInterest = getTotalActiveInterest(state);
    const totalHistoricalInterest = getTotalHistoricalInterest(state);
    const totalHistoricalDue = getTotalHistoricalDue(state);
    const totalHistoricalPaid = getTotalHistoricalPaid(state);
    const closedLoansCount = getClosedLoansCount(state);

    return `
        <div class="loans-overview">
            <main class="loans-overview__main">
                <div class="loans-overview__mobile-kpis">
                    ${kpiCard('Saldo pendiente', formatCurrency(totalExposure), '#f59e0b', 'payroll', 'Total facturado', formatCurrency(totalHistoricalDue))}
                    ${kpiCard('Total pagado', formatCurrency(totalPaid), 'rgb(16, 185, 115)', 'check', 'Total histórico', formatCurrency(totalHistoricalPaid))}
                    ${kpiCard('Interés total', formatCurrency(totalActiveInterest), '#f43f5e', 'analytics', 'Total histórico', formatCurrency(totalHistoricalInterest))}
                    ${kpiCard('Empleados con deuda', allWithDebt.length.toString(), '#06b6d4', 'personnel', 'Inactivos', inactiveWithDebt.length.toString())}
                    ${kpiCard('Préstamos activos', totalLoans.toString(), '#a855f7', 'briefcase', 'Cerrados', closedLoansCount.toString())}
                </div>

                ${inactiveWithDebt.length > 0 ? `
                    <div class="loans-inactive-debt-alert" role="status">
                        <span aria-hidden="true">${icons.get('alert', { size: 18 })}</span>
                        <div>
                            <strong>${inactiveWithDebt.length} empleado${inactiveWithDebt.length === 1 ? '' : 's'} inactivo${inactiveWithDebt.length === 1 ? '' : 's'} mantiene${inactiveWithDebt.length === 1 ? '' : 'n'} préstamos activos.</strong>
                            <span>${inactiveWithDebt.length === 1 ? 'No se incluye' : 'No se incluyen'} en Nómina, pero podés gestionar ${inactiveWithDebt.length === 1 ? 'su deuda' : 'sus deudas'} desde este libro.</span>
                        </div>
                    </div>
                ` : ''}

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
                            style="padding: 10px 16px; background: #f59e0b; color: #000; border: none; border-radius: 8px; font-weight: 800; font-size: 0.85rem; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;">
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
                     style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 10px;"
                     onmouseover="this.style.borderColor='#06b6d4'"
                     onmouseout="this.style.borderColor='#334155'">
                    <!-- Number avatar -->
                    <div style="width: 36px; height: 36px; background: rgba(245,158,11,0.12); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #f59e0b; font-weight: 800; font-size: 0.8rem; flex-shrink: 0;">
                        ${emp.number || '?'}
                    </div>
                    <!-- Name + sub-line, takes whatever space is left -->
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 7px; min-width: 0;">
                            <span style="color: #f1f5f9; font-weight: 700; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(emp.name)}</span>
                            ${emp.active === false ? '<span class="loan-employee-status loan-employee-status--inactive">Inactivo</span>' : ''}
                        </div>
                        <div style="color: #94a3b8; font-size: 0.7rem; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${emp.loanCount} préstamo${emp.loanCount === 1 ? '' : 's'} · Pagado ${formatCurrency(emp.totalPaid)}
                        </div>
                    </div>
                    <!-- Balance pinned to the right -->
                    <div style="text-align: right; flex-shrink: 0;">
                        <div style="font-size: 1.05rem; font-weight: 900; color: #f59e0b; line-height: 1.1;">${formatCurrency(emp.totalBalance)}</div>
                        <div style="font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">de ${formatCurrency(emp.totalDue)}</div>
                    </div>
                </div>
                `).join('')}

                <!-- Apartado colapsable: Cuentas Saldadas (Inactivas) -->
                ${allInactive.length > 0 ? `
                <div style="margin-top: 30px; margin-bottom: 20px;">
                    <button type="button" data-app-fn="toggleInactiveHistory"
                            style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; color: #e2e8f0; font-weight: 700; font-size: 0.85rem; cursor: pointer; text-align: left; outline: none; transition: border-color 0.15s;"
                            onmouseover="this.style.borderColor='#94a3b8'"
                            onmouseout="this.style.borderColor='#334155'">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="color: rgb(16, 185, 115); display: inline-flex; align-items: center;">${icons.get('check', { size: 16 })}</span>
                            <span>Historial de cuentas saldadas (${allInactive.length})</span>
                        </div>
                        <span style="font-size: 0.75rem; color: #64748b;">
                            ${ledger.showInactiveHistory ? 'Ocultar ▲' : 'Mostrar ▼'}
                        </span>
                    </button>
                    
                    ${ledger.showInactiveHistory ? `
                        <div style="margin-top: 8px;">
                            ${filteredInactive.length === 0 ? `
                                <div style="text-align: center; padding: 20px; color: #64748b; font-size: 0.85rem;">
                                    No se encontraron cuentas saldadas que coincidan
                                </div>
                            ` : filteredInactive.map(emp => `
                                <div role="button" tabindex="0"
                                     data-app-fn="selectLoansEmployee" data-arg="${emp.employeeId}"
                                     style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 10px; opacity: 0.8;"
                                     onmouseover="this.style.borderColor='rgb(16, 185, 115)'; this.style.opacity='1'"
                                     onmouseout="this.style.borderColor='#334155'; this.style.opacity='0.8'">
                                    <!-- Number avatar -->
                                    <div style="width: 36px; height: 36px; background: rgba(16,185,115,0.12); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: rgb(16, 185, 115); font-weight: 800; font-size: 0.8rem; flex-shrink: 0;">
                                        ${emp.number || '?'}
                                    </div>
                                    <!-- Name + sub-line -->
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="color: #e2e8f0; font-weight: 700; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(emp.name)}</div>
                                        <div style="color: #94a3b8; font-size: 0.7rem; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                            ${emp.loanCount} préstamo${emp.loanCount === 1 ? '' : 's'} · Totalmente pagado
                                        </div>
                                    </div>
                                    <!-- Total paid/due pinned to the right -->
                                    <div style="text-align: right; flex-shrink: 0;">
                                        <div style="font-size: 0.95rem; font-weight: 800; color: rgb(16, 185, 115); line-height: 1.1;">${formatCurrency(emp.totalPaid)}</div>
                                        <div style="font-size: 0.6rem; color: #64748b; text-transform: uppercase;">recuperado</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
                ` : ''}
            </main>

            <aside class="loans-overview__summary" aria-label="Resumen de cuentas por cobrar">
                <div class="loans-overview__summary-header">
                    <span>Resumen de cartera</span>
                    <strong>Actualizado al período vigente</strong>
                </div>
                <table>
                    <tbody>
                        <tr>
                            <th scope="row">Saldo pendiente<small>Total facturado ${formatCurrency(totalHistoricalDue)}</small></th>
                            <td>${formatCurrency(totalExposure)}</td>
                        </tr>
                        <tr>
                            <th scope="row">Total pagado<small>Histórico ${formatCurrency(totalHistoricalPaid)}</small></th>
                            <td>${formatCurrency(totalPaid)}</td>
                        </tr>
                        <tr>
                            <th scope="row">Interés activo<small>Histórico ${formatCurrency(totalHistoricalInterest)}</small></th>
                            <td>${formatCurrency(totalActiveInterest)}</td>
                        </tr>
                        <tr>
                            <th scope="row">Empleados con deuda<small>${inactiveWithDebt.length} inactivos · ${allInactive.length} cuentas saldadas</small></th>
                            <td>${allWithDebt.length}</td>
                        </tr>
                        <tr>
                            <th scope="row">Préstamos activos<small>${closedLoansCount} cerrados</small></th>
                            <td>${totalLoans}</td>
                        </tr>
                    </tbody>
                </table>
                <p>Este resumen no modifica saldos ni registra movimientos.</p>
            </aside>
        </div>
    `;
}

function kpiCard(label, value, color, iconName, subLabel = '', subValue = '') {
    const subHTML = (subLabel && subValue)
        ? `<div style="font-size: 0.65rem; color: #64748b; margin-top: 6px; border-top: 1px dashed #334155; padding-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeAttr(`${subLabel}: ${subValue}`)}">${subLabel}: <span style="font-weight: 700;">${subValue}</span></div>`
        : '';
    return `
        <div style="background: #1e293b; border-radius: 10px; padding: 12px; border: 1px solid #334155; border-left: 4px solid ${color}; min-width: 0; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                    <div style="color: ${color}; flex-shrink: 0;">${icons.get(iconName, { size: 16 })}</div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.03em; line-height: 1.2;">${label}</div>
                </div>
                <div style="font-size: 1.15rem; font-weight: 900; color: #f1f5f9; word-break: break-word; line-height: 1.1;">${value}</div>
            </div>
            ${subHTML}
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
    const employeeNameParts = String(emp.name || '').trim().split(/\s+/).filter(Boolean);
    const employeeFirstName = employeeNameParts.shift() || 'Sin nombre';
    const employeeRemainingName = employeeNameParts.join(' ');

    const ledger = state.loansLedger || {};
    const showAddForm = !!ledger.showAddForm;

    // Fase 2 U4: detector post-merge de posibles duplicados por creación
    // concurrente (doble señal: mismo seq + monto igual + fechas cercanas).
    // U4 solo avisa; el wizard de resolución es U5.
    const duplicateCandidates = detectLoanDuplicateCandidates(emp);

    return `
        <div class="loans-employee-detail" style="max-width: 1000px; margin: 0 auto;">
            <!-- Header with back button -->
            <div class="loans-detail-header" style="background: #1e293b; border-radius: 12px; padding: 16px 18px; border: 1px solid #334155; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                <div class="loans-detail-header__identity" style="display: flex; align-items: center; gap: 12px;">
                    <button type="button"
                            class="loans-detail-back"
                            data-app-fn="clearLoansEmployee"
                            aria-label="Volver a cuentas por cobrar">
                        <svg class="loans-detail-back__icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M19 12H5"></path>
                            <path d="m12 19-7-7 7-7"></path>
                        </svg>
                    </button>
                    <div class="loans-detail-header__employee">
                        <div class="loans-detail-header__name" style="color: #f1f5f9; font-weight: 800; font-size: 1.1rem;">
                            <span class="loans-detail-header__name-line">${escapeHTML(employeeFirstName)}</span>
                            ${employeeRemainingName ? `<span class="loans-detail-header__name-line">${escapeHTML(employeeRemainingName)}</span>` : ''}
                        </div>
                        <div class="loans-detail-header__number" style="color: #94a3b8; font-size: 0.8rem;">#${emp.number}</div>
                    </div>
                </div>
                <div class="loans-detail-header__balance" style="text-align: right;">
                    <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Saldo pendiente</div>
                    <div style="font-size: 1.5rem; font-weight: 900; color: #f59e0b;">${formatCurrency(totalBalance)}</div>
                </div>
            </div>

            ${duplicateCandidates.length > 0 ? `
                <div style="background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.5); border-radius: 12px; padding: 14px 16px; margin-bottom: 16px;">
                    <div style="color: #fca5a5; font-weight: 800; font-size: 0.85rem; margin-bottom: 6px;">⚠️ Posibles préstamos duplicados</div>
                    <div style="color: #cbd5e1; font-size: 0.78rem; line-height: 1.5; margin-bottom: 4px;">
                        Estos pares tienen el mismo monto, fecha cercana y el mismo número de secuencia — pueden ser el MISMO préstamo anotado desde dos dispositivos.
                    </div>
                    ${duplicateCandidates.map(c => `
                        <div style="background: rgba(15,23,42,0.6); border-radius: 8px; padding: 10px 12px; margin-top: 8px;">
                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                ${[c.a, c.b].map(l => `
                                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                                        <span style="color: #e2e8f0; font-size: 0.78rem;">
                                            "${escapeHTML(l.concept || 'Préstamo')}" · ${formatDateShort(l.startDate)} · ${formatCurrency(l.principal)}
                                            ${getPaidAmount(l) > 0 ? ` · <span style="color:#6ee7b7;">abonado ${formatCurrency(getPaidAmount(l))}</span>` : ''}
                                        </span>
                                        <button type="button" data-app-fn="resolveDupDeleteLoan" data-arg="${escapeAttr(l.id)}"
                                                style="padding: 4px 10px; background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.6); color: #fca5a5; border-radius: 6px; font-size: 0.72rem; font-weight: 700; cursor: pointer; white-space: nowrap;">
                                            🗑️ Eliminar este
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                            <button type="button" data-app-fn="resolveDupKeepBoth" data-arg="${escapeAttr(c.a.id)}" data-arg2="${escapeAttr(c.b.id)}"
                                    style="margin-top: 8px; width: 100%; padding: 6px 10px; background: rgba(16,185,115,0.15); border: 1px solid rgba(16,185,115,0.5); color: #6ee7b7; border-radius: 6px; font-size: 0.72rem; font-weight: 700; cursor: pointer;">
                                ✓ Son préstamos distintos — conservar ambos
                            </button>
                        </div>
                    `).join('')}
                    <div style="margin-top: 8px; color: #94a3b8; font-size: 0.72rem;">Si abonaron cuotas sobre uno de los dos, conservá ese — el monto abonado se muestra en verde.</div>
                </div>
            ` : ''}

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
                    <summary style="cursor: pointer; font-size: 0.8rem; font-weight: 700; color: rgb(16, 185, 115); text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 0;">
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

function DisclosureControl() {
    return `
        <span class="loan-card__disclosure-control" aria-hidden="true">
            <span class="loan-card__disclosure-icon loan-card__disclosure-icon--closed">${icons.get('add', { size: 15 })}</span>
            <span class="loan-card__disclosure-icon loan-card__disclosure-icon--open">${icons.get('subtract', { size: 15 })}</span>
        </span>
    `;
}

function LoanCard(loan) {
    const terms = getActiveLoanTerms(loan);
    const balance = getBalance(loan);
    const totalDue = getTotalDue(loan);
    const paid = getPaidAmount(loan);
    const isActive = loan.status === LOAN_STATUS.ACTIVE;
    const isPaid = loan.status === LOAN_STATUS.PAID;
    const isWrittenOff = loan.status === LOAN_STATUS.WRITTEN_OFF;
    const ledger = state.loansLedger || {};
    const showPay = ledger.showPaymentFormForLoan === loan.id;
    const showRefin = ledger.showRefinanceFormForLoan === loan.id;
    const visiblePayments = (loan.payments || []).filter(p => !p.voided);
    const refinancings = (loan.refinancings || []).filter(r => !r.voided);
    const refinCount = getRefinanceCount(loan);
    const totalInterest = getTotalInterestAccrued(loan);
    const isInstallmentLoan = terms.installmentMode === INSTALLMENT_MODE.INSTALLMENTS;
    const installmentCount = terms.installments.length;
    const repaymentOptions = getPayrollDeductionOptions(loan);
    const nextCharge = repaymentOptions[0] || null;
    const repaymentLabel = isInstallmentLoan ? `En cuotas · ${installmentCount}` : 'Pago único';
    const repaymentBadge = `<span class="loan-card__repayment-badge loan-card__repayment-badge--${isInstallmentLoan ? 'installments' : 'lump'}">${repaymentLabel}</span>`;
    const nextChargeLabel = nextCharge
        ? nextCharge.kind === 'installment'
            ? `Próxima: cuota ${nextCharge.installmentSeq} · ${formatCurrency(nextCharge.amount)} · ${formatDateShort(nextCharge.dueDate)}`
            : nextCharge.kind === 'balance-adjustment'
                ? `Próximo cargo: saldo adicional · ${formatCurrency(nextCharge.amount)}`
                : `Próximo cargo: saldo completo · ${formatCurrency(nextCharge.amount)}`
        : '';
    const activityEntries = [
        ...visiblePayments.map(item => ({ type: 'payment', date: item.date, item })),
        ...refinancings.map(item => ({ type: 'refinancing', date: item.date, item }))
    ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const activityMeta = [
        visiblePayments.length > 0 ? `${formatCurrency(paid)} pagado` : '',
        refinCount > 0 ? `${refinCount} refinanciamiento${refinCount === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(' · ');

    // Fase 2 U4: badge "pendiente de subir" — el préstamo tiene cambios con
    // updatedAt POSTERIOR a la última subida de entidades confirmada
    // (EntitiesSyncStamp). Solo con sesión: sin cuenta conectada, "pendiente
    // de subir" no significa nada y sería ruido.
    const hasSession = typeof window !== 'undefined' && !!window.currentUser;
    const pendingUploadBadge = (hasSession && isPendingUpload(loan.updatedAt))
        ? `<span title="Los últimos cambios de este préstamo todavía no se confirmaron en la nube. Se suben solos al sincronizar." style="background: rgba(245,158,11,0.15); border: 1px solid rgba(245,158,11,0.55); color: #fcd34d; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; white-space: nowrap;">☁️ Pendiente de subir</span>`
        : '';

    const statusBadge = isActive
        ? `<span style="background: #f59e0b; color: #000; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800;">ACTIVO</span>`
        : loan.status === LOAN_STATUS.PAID
            ? `<span style="background: rgb(16, 185, 115); color: #000; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800;">SALDADO</span>`
            : `<span style="background: #64748b; color: #fff; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800;">ANULADO</span>`;

    return `
        <div class="loan-card" style="background: #1e293b; border-radius: 12px; padding: 16px 18px; border: 1px solid #334155; margin-bottom: 12px; ${isWrittenOff ? 'opacity: 0.6;' : ''}">
            <!-- Top line: concept + status -->
            <div class="loan-card__desktop-header" style="display: flex; justify-content: space-between; align-items: start; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px;">
                    <div style="font-size: 0.95rem; font-weight: 700; color: #f1f5f9; margin-bottom: 4px;">${escapeHTML(loan.concept || 'Préstamo')}</div>
                    <div class="loan-card__repayment-line">
                        <span>${formatDateShort(terms.startDate)}</span>
                        ${repaymentBadge}
                    </div>
                    ${isActive && nextChargeLabel ? `<div class="loan-card__next-charge">${nextChargeLabel}</div>` : ''}
                    ${loan.updatedAt ? `
                        <div style="font-size: 0.68rem; color: #64748b; margin-top: 2px;">
                            ⏱️ Último cambio: ${formatTimeSince(loan.updatedAt)}
                        </div>
                    ` : ''}
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
                    ${statusBadge}
                    ${pendingUploadBadge}
                </div>
            </div>

            <!-- Desktop numbers row -->
            <div class="loan-card__metrics loan-card__metrics--desktop">
                <div>
                    <div class="loan-card__metric-label">Capital</div>
                    <div class="loan-card__metric-value">${formatCurrency(terms.principal)}</div>
                </div>
                <div>
                    <div class="loan-card__metric-label">Interés</div>
                    <div class="loan-card__metric-value">${terms.interestRate}%${terms.interestIncluded ? ' (incl.)' : ''}</div>
                </div>
                <div>
                    <div class="loan-card__metric-label">Int. acumulado</div>
                    <div class="loan-card__metric-value ${refinCount > 0 ? 'loan-card__metric-value--refinanced' : ''}" title="Interés total acumulado (original + refinanciamientos)">${formatCurrency(totalInterest)}</div>
                </div>
                <div>
                    <div class="loan-card__metric-label">Total</div>
                    <div class="loan-card__metric-value">${formatCurrency(totalDue)}</div>
                </div>
                <div>
                    <div class="loan-card__metric-label">Pagado</div>
                    <div class="loan-card__metric-value loan-card__metric-value--paid">${formatCurrency(paid)}</div>
                </div>
                <div>
                    <div class="loan-card__metric-label">Saldo pendiente</div>
                    <div class="loan-card__metric-value ${balance > 0 ? 'loan-card__metric-value--pending' : 'loan-card__metric-value--paid'}">${formatCurrency(balance)}</div>
                </div>
            </div>

            <!-- Mobile compact summary + financial disclosure -->
            <details class="loan-card__breakdown">
                <summary class="loan-card__mobile-summary">
                    <span class="loan-card__mobile-identity">
                        <strong>
                            ${escapeHTML(loan.concept || 'Préstamo')}
                            ${Number.isFinite(Number(loan.seq)) ? `<b>#${Number(loan.seq)}</b>` : ''}
                        </strong>
                        <span>
                            ${formatDateShort(terms.startDate)}
                        </span>
                        ${repaymentBadge}
                        ${isActive && nextChargeLabel ? `<small class="loan-card__next-charge">${nextChargeLabel}</small>` : ''}
                        ${loan.updatedAt ? `<small>⏱️ Último cambio: ${formatTimeSince(loan.updatedAt)}</small>` : ''}
                    </span>
                    <span class="loan-card__pending">
                        <span>Saldo pendiente</span>
                        <strong class="${balance > 0 ? '' : 'loan-card__pending--paid'}">${formatCurrency(balance)}</strong>
                    </span>
                    <span class="loan-card__mobile-state">
                        ${statusBadge}
                        ${DisclosureControl()}
                    </span>
                </summary>
                <div class="loan-card__breakdown-body">
                    <div class="loan-card__breakdown-title">Desglose financiero</div>
                    <div class="loan-card__metrics loan-card__metrics--breakdown">
                        <div>
                            <div class="loan-card__metric-label">Capital</div>
                            <div class="loan-card__metric-value">${formatCurrency(terms.principal)}</div>
                        </div>
                        <div>
                            <div class="loan-card__metric-label">Interés</div>
                            <div class="loan-card__metric-value">${terms.interestRate}%${terms.interestIncluded ? ' (incl.)' : ''}</div>
                        </div>
                        <div>
                            <div class="loan-card__metric-label">Int. acumulado</div>
                            <div class="loan-card__metric-value ${refinCount > 0 ? 'loan-card__metric-value--refinanced' : ''}">${formatCurrency(totalInterest)}</div>
                        </div>
                        <div>
                            <div class="loan-card__metric-label">Total</div>
                            <div class="loan-card__metric-value">${formatCurrency(totalDue)}</div>
                        </div>
                        <div>
                            <div class="loan-card__metric-label">Pagado</div>
                            <div class="loan-card__metric-value loan-card__metric-value--paid">${formatCurrency(paid)}</div>
                        </div>
                    </div>
                </div>
            </details>

            <!-- Unified activity history -->
            ${activityEntries.length > 0 ? `
                <details class="loan-card__history loan-card__history--activity">
                    <summary>
                        <span class="loan-card__history-copy">
                            <span class="loan-card__history-title">Actividad · ${activityEntries.length} movimiento${activityEntries.length === 1 ? '' : 's'}</span>
                            <span class="loan-card__history-meta">${activityMeta}</span>
                        </span>
                        ${DisclosureControl()}
                    </summary>
                    <div class="loan-card__history-body">
                        ${activityEntries.map(({ type, item }) => type === 'payment' ? `
                            <div class="loan-card__activity-row loan-card__activity-row--payment">
                                <span class="loan-card__activity-marker" aria-hidden="true"></span>
                                <div class="loan-card__activity-copy">
                                    <div>
                                        <strong>+${formatCurrency(item.amount)}</strong>
                                        <span>${formatDateShort(item.date)}</span>
                                    </div>
                                    ${item.note ? `<small>${escapeHTML(item.note)}</small>` : ''}
                                </div>
                                ${(isActive || isPaid) ? `<button type="button" class="loan-card__activity-void"
                                                      data-app-fn="voidPaymentHandler" data-arg="${loan.id}" data-arg2="${item.id}"
                                                      title="${isPaid ? 'Anular este abono (reabre el préstamo)' : 'Anular este abono'}">✕</button>` : ''}
                            </div>
                        ` : `
                            <div class="loan-card__activity-row loan-card__activity-row--refinancing">
                                <span class="loan-card__activity-marker" aria-hidden="true"></span>
                                <div class="loan-card__activity-copy">
                                    <div>
                                        <strong>+${formatCurrency(item.interestAmount)}</strong>
                                        <span>${formatDateShort(item.date)}</span>
                                    </div>
                                    <small>${item.interestRate}% sobre ${item.basis === 'balance' ? 'saldo' : 'capital'} (${formatCurrency(item.baseAmount)})${item.note ? ` · ${escapeHTML(item.note)}` : ''}</small>
                                </div>
                                ${isActive ? `<button type="button" class="loan-card__activity-void"
                                                      data-app-fn="voidRefinanceHandler" data-arg="${loan.id}" data-arg2="${item.id}"
                                                      title="Anular este refinanciamiento">✕</button>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </details>
            ` : ''}

            <!-- Payment form -->
            ${isActive && showPay ? PaymentForm(loan, balance) : ''}

            <!-- Refinance form -->
            ${isActive && showRefin ? RefinanceForm(loan, balance) : ''}

            <!-- Actions -->
            ${isActive && !showPay && !showRefin ? `
                <div class="loan-card__actions">
                    <button type="button"
                            class="loan-card__action loan-card__action--payment"
                            data-app-fn="togglePaymentForm"
                            data-arg="${loan.id}">
                        Realizar pago
                    </button>
                    <div class="loan-card__desktop-actions">
                        <button type="button"
                                class="loan-card__action loan-card__action--desktop-refinance"
                                data-app-fn="toggleRefinanceForm"
                                data-arg="${loan.id}">
                            Refinanciar
                        </button>
                        <button type="button"
                                class="loan-card__action loan-card__action--desktop-settle"
                                data-app-fn="settleLoanByFullPayment"
                                data-arg="${loan.id}">
                            Saldar
                        </button>
                        <button type="button"
                                class="loan-card__action loan-card__action--desktop-danger"
                                data-app-fn="writeOffLoanWithConfirm"
                                data-arg="${loan.id}"
                                aria-label="Anular préstamo"
                                title="Anular préstamo">
                            ${icons.get('delete', { size: 14 })}
                        </button>
                    </div>
                    <details class="loan-card__more-actions">
                        <summary class="loan-card__action loan-card__action--more">Más acciones</summary>
                        <div class="loan-card__more-menu">
                            <button type="button"
                                    class="loan-card__more-item loan-card__more-item--refinance"
                                    data-app-fn="toggleRefinanceForm"
                                    data-arg="${loan.id}">
                                <svg class="loan-card__more-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M20 7h-5V2"></path>
                                    <path d="M20 7a8 8 0 0 0-13.7-2.3L4 7"></path>
                                    <path d="M4 17h5v5"></path>
                                    <path d="M4 17a8 8 0 0 0 13.7 2.3L20 17"></path>
                                </svg>
                                Refinanciar
                            </button>
                            <button type="button"
                                    class="loan-card__more-item loan-card__more-item--settle"
                                    data-app-fn="settleLoanByFullPayment"
                                    data-arg="${loan.id}">
                                <svg class="loan-card__more-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <circle cx="12" cy="12" r="9"></circle>
                                    <path d="M15.2 8.5c-.7-.6-1.7-.9-2.8-.9-1.5 0-2.6.7-2.6 1.8 0 2.8 5.1 1.4 5.1 4.3 0 1.1-1.1 1.9-2.8 1.9-1.2 0-2.4-.4-3.2-1.1"></path>
                                    <path d="M12 5.8v12.4"></path>
                                </svg>
                                Saldar <span>(pago total)</span>
                            </button>
                            <button type="button"
                                    class="loan-card__more-item loan-card__more-item--danger"
                                    data-app-fn="writeOffLoanWithConfirm"
                                    data-arg="${loan.id}">
                                ${icons.get('delete', { size: 14 })} Anular préstamo
                            </button>
                        </div>
                    </details>
                </div>
            ` : isWrittenOff ? `
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button type="button" data-app-fn="reopenLoanHandler" data-arg="${loan.id}"
                            style="padding: 8px 14px; background: transparent; color: #06b6d4; border: 1px solid #06b6d4; border-radius: 8px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
                        Reactivar
                    </button>
                    <button type="button" data-app-fn="deleteLoanWithConfirm" data-arg="${loan.id}"
                            style="padding: 8px 14px; background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 8px; font-weight: 700; font-size: 0.8rem; cursor: pointer;"
                            title="Eliminar este préstamo de forma permanente">
                        ${icons.get('delete', { size: 14 })} Eliminar
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

// ─── PAYMENT (abono) FORM ────────────────────────────────────────────────────

function PaymentForm(loan, balance) {
    const draft = (state.loansLedger || {}).paymentDraft || { amount: 0, date: '', note: '' };
    const isInstallmentLoan = getActiveLoanTerms(loan).installmentMode === INSTALLMENT_MODE.INSTALLMENTS;
    const resolvedDraft = resolveLoanPaymentDraft(loan, draft);
    const choices = getInstallmentPaymentChoices(loan);
    const firstCharge = choices[0]?.firstCharge || null;
    const selectedChoice = choices[Math.max(0, resolvedDraft.installmentCount - 1)] || choices[0] || null;
    const installmentActionLabel = resolvedDraft.mode === PAYMENT_PLAN_MODE.TOTAL
        ? 'Pagar préstamo completo'
        : resolvedDraft.mode === PAYMENT_PLAN_MODE.MULTIPLE
            ? `Pagar ${resolvedDraft.installmentCount} cuotas`
            : 'Pagar una cuota';
    const selectionDetail = resolvedDraft.mode === PAYMENT_PLAN_MODE.TOTAL
        ? `Saldo completo · ${formatCurrency(resolvedDraft.amount)}`
        : resolvedDraft.mode === PAYMENT_PLAN_MODE.MULTIPLE
            ? `Cuotas ${firstCharge?.installmentSeq || 1}–${selectedChoice?.lastCharge?.installmentSeq || resolvedDraft.installmentCount} · ${formatCurrency(resolvedDraft.amount)}`
            : firstCharge?.kind === 'installment'
                ? `Cuota ${firstCharge.installmentSeq} · ${formatCurrency(resolvedDraft.amount)} · ${formatDateShort(firstCharge.dueDate)}`
                : `Próximo cargo · ${formatCurrency(resolvedDraft.amount)}`;
    const installmentHelp = resolvedDraft.mode === PAYMENT_PLAN_MODE.TOTAL
        ? 'El préstamo quedará saldado al registrar este pago.'
        : resolvedDraft.mode === PAYMENT_PLAN_MODE.MULTIPLE
            ? 'Se pagarán cuotas consecutivas empezando por la más próxima pendiente.'
            : 'Se pagará únicamente la próxima cuota pendiente.';

    return `
        <div class="loan-operation-form loan-operation-form--payment">
            <div class="loan-operation-form__title">Realizar pago</div>
            ${isInstallmentLoan ? `
                <div class="loan-payment-plan" role="group" aria-label="Forma de pago">
                    <button type="button"
                            class="loan-payment-plan__option ${resolvedDraft.mode === PAYMENT_PLAN_MODE.SINGLE ? 'is-active' : ''}"
                            aria-pressed="${resolvedDraft.mode === PAYMENT_PLAN_MODE.SINGLE}"
                            data-app-fn="setPaymentDraftField"
                            data-arg="mode"
                            data-arg2="${PAYMENT_PLAN_MODE.SINGLE}">
                        <span>Pagar una cuota</span>
                        <strong>${formatCurrency(choices[0]?.amount || 0)}</strong>
                        <small>${firstCharge?.kind === 'installment' ? `Cuota ${firstCharge.installmentSeq}` : 'Próximo cargo'}</small>
                    </button>
                    <button type="button"
                            class="loan-payment-plan__option ${resolvedDraft.mode === PAYMENT_PLAN_MODE.MULTIPLE ? 'is-active' : ''}"
                            aria-pressed="${resolvedDraft.mode === PAYMENT_PLAN_MODE.MULTIPLE}"
                            data-app-fn="setPaymentDraftField"
                            data-arg="mode"
                            data-arg2="${PAYMENT_PLAN_MODE.MULTIPLE}"
                            ${choices.length < 2 ? 'disabled' : ''}>
                        <span>Pagar varias cuotas</span>
                        <strong>${choices.length > 1 ? `2–${choices.length}` : '—'}</strong>
                        <small>Consecutivas</small>
                    </button>
                    <button type="button"
                            class="loan-payment-plan__option ${resolvedDraft.mode === PAYMENT_PLAN_MODE.TOTAL ? 'is-active' : ''}"
                            aria-pressed="${resolvedDraft.mode === PAYMENT_PLAN_MODE.TOTAL}"
                            data-app-fn="setPaymentDraftField"
                            data-arg="mode"
                            data-arg2="${PAYMENT_PLAN_MODE.TOTAL}">
                        <span>Pagar completo</span>
                        <strong>${formatCurrency(balance)}</strong>
                        <small>Saldar préstamo</small>
                    </button>
                </div>
                ${resolvedDraft.mode === PAYMENT_PLAN_MODE.MULTIPLE ? `
                    <label class="loan-payment-plan__count">
                        <span>Cuotas a pagar</span>
                        <select onchange="setPaymentDraftField('installmentCount', this.value)">
                            ${choices.slice(1).map(choice => `
                                <option value="${choice.count}" ${choice.count === resolvedDraft.installmentCount ? 'selected' : ''}>
                                    ${choice.count} cuotas · ${formatCurrency(choice.amount)}
                                </option>
                            `).join('')}
                        </select>
                    </label>
                ` : ''}
                <div class="loan-payment-plan__summary">
                    <span>Pago seleccionado</span>
                    <strong>${selectionDetail}</strong>
                </div>
            ` : ''}
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px;">
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">${isInstallmentLoan ? 'Monto calculado' : 'Monto a pagar'}</label>
                    <input type="number" inputmode="decimal" autocomplete="off"
                           value="${resolvedDraft.amount || ''}" max="${balance}" min="0" step="0.01"
                           ${isInstallmentLoan ? 'readonly' : `oninput="setPaymentDraftField('amount', this.value)"`}
                           placeholder="0.00"
                           class="${isInstallmentLoan ? 'loan-payment-plan__amount' : ''}"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Fecha</label>
                    <input type="date" value="${resolvedDraft.date}"
                           onchange="setPaymentDraftField('date', this.value)"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Concepto</label>
                    <input type="text" value="${escapeAttr(resolvedDraft.note || '')}"
                           oninput="setPaymentDraftField('note', this.value)"
                           placeholder="opcional"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
            </div>
            <div style="margin: -2px 0 10px; color: #7f8b98; font-size: 0.68rem;">
                ${isInstallmentLoan
                    ? installmentHelp
                    : 'Si ingresas el saldo pendiente completo, el préstamo se saldará automáticamente.'}
            </div>
            <div class="loan-payment-form__actions">
                <button type="button"
                        class="loan-payment-form__action loan-payment-form__action--save"
                        data-app-fn="submitPayment"
                        data-arg="${loan.id}">
                    ${isInstallmentLoan ? installmentActionLabel : 'Guardar pago'}
                </button>
                ${isInstallmentLoan ? '' : `<button type="button"
                        class="loan-payment-form__action loan-payment-form__action--total"
                        data-app-fn="settleLoanByFullPayment"
                        data-arg="${loan.id}">
                    Pago total
                </button>`}
                <button type="button"
                        class="loan-payment-form__action loan-payment-form__action--cancel"
                        data-app-fn="togglePaymentForm"
                        data-arg="${loan.id}">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

// ─── REFINANCE (refinanciamiento) FORM ────────────────────────────────────────

function RefinanceForm(loan, balance) {
    const draft = (state.loansLedger || {}).refinanceDraft || {
        basis: 'balance',
        mode: 'installments',
        interestRate: 0,
        installmentCount: 2,
        installmentFrequencyWeeks: 2,
        note: ''
    };
    const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const basis = draft.basis === 'principal' ? 'principal' : 'balance';
    const isInstallments = draft.mode === 'installments';
    const originalPrincipal = r2(Number(loan.principal || 0));
    const baseAmount = basis === 'principal' ? originalPrincipal : balance;
    const rate = Number(draft.interestRate || 0);
    const interestToAdd = r2(baseAmount * rate / 100);
    const newBalance = r2(balance + interestToAdd);
    const count = Number(draft.installmentCount || 2);
    const approxInstallment = isInstallments && count > 0 ? r2(newBalance / count) : 0;

    return `
        <div class="loan-operation-form loan-operation-form--refinance">
            <div class="loan-operation-form__title">Refinanciar préstamo</div>
            <p style="color: #94a3b8; font-size: 0.82rem; margin: 0 0 12px;">Aplica un interés adicional por refinanciamiento y define la modalidad de pago.</p>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 12px;">
                <div>
                    <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 4px; font-weight: 600;">Base de cálculo del interés</label>
                    <select onchange="setRefinanceDraftField('basis', this.value)"
                            style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.88rem;">
                        <option value="balance" ${basis === 'balance' ? 'selected' : ''}>Saldo restante (${formatCurrency(balance)})</option>
                        <option value="principal" ${basis === 'principal' ? 'selected' : ''}>Capital original (${formatCurrency(originalPrincipal)})</option>
                    </select>
                </div>
                <div>
                    <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 4px; font-weight: 600;">Modalidad tras refinanciar</label>
                    <select onchange="setRefinanceDraftField('mode', this.value)"
                            style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.88rem;">
                        <option value="installments" ${isInstallments ? 'selected' : ''}>Dividir en nuevas cuotas</option>
                        <option value="lump" ${!isInstallments ? 'selected' : ''}>Pago único (saldo acumulado)</option>
                    </select>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 12px;">
                <div>
                    <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 4px; font-weight: 600;">Tasa de interés (%)</label>
                    <input type="number" inputmode="decimal" autocomplete="off" value="${draft.interestRate || ''}"
                           min="0" max="${VALIDATION.MAX_INTEREST_PERCENT}" step="0.1"
                           oninput="setRefinanceDraftField('interestRate', this.value)" placeholder="0"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                ${isInstallments ? `
                <div>
                    <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 4px; font-weight: 600;">Frecuencia</label>
                    <select onchange="setRefinanceDraftField('installmentFrequencyWeeks', this.value)"
                            style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.88rem;">
                        ${[1, 2, 3, 4].map(weeks => `<option value="${weeks}" ${Number(draft.installmentFrequencyWeeks || 2) === weeks ? 'selected' : ''}>Cada ${weeks} semana${weeks === 1 ? '' : 's'}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 4px; font-weight: 600;">Nuevas cuotas</label>
                    <input type="number" inputmode="numeric" value="${draft.installmentCount || 2}" min="1" max="${VALIDATION.MAX_INSTALLMENTS}" step="1"
                           oninput="setRefinanceDraftField('installmentCount', this.value)"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>` : ''}
                <div>
                    <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 4px; font-weight: 600;">Nota (opcional)</label>
                    <input type="text" value="${escapeAttr(draft.note || '')}"
                           oninput="setRefinanceDraftField('note', this.value)" placeholder="motivo"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
            </div>

            <div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; padding: 10px 12px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; margin-bottom: 12px; font-size: 0.82rem;">
                <span style="color: #94a3b8;">Base: <strong style="color: #f1f5f9;">${formatCurrency(baseAmount)}</strong></span>
                <span style="color: #94a3b8;">Interés a agregar: <strong style="color: #a78bfa;">+${formatCurrency(interestToAdd)} (${rate}%)</strong></span>
                <span style="color: #94a3b8;">Nuevo saldo: <strong style="color: #f59e0b;">${formatCurrency(newBalance)}</strong></span>
                ${isInstallments && count > 0 ? `<span style="color: #94a3b8;">Cuotas est.: <strong style="color: #38bdf8;">${count} × ~${formatCurrency(approxInstallment)}</strong></span>` : ''}
            </div>

            <div class="loan-refinance-form__actions">
                <button type="button" data-app-fn="submitRefinance" data-arg="${loan.id}"
                        class="loan-refinance-form__action loan-refinance-form__action--save">
                    Aplicar refinanciamiento
                </button>
                <button type="button" data-app-fn="toggleRefinanceForm" data-arg="${loan.id}"
                        class="loan-refinance-form__action loan-refinance-form__action--cancel">
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
// employee with a quick filter; tapping a row closes the picker and opens the
// ledger's loan form for that employee.

function EmployeePickerOverlay() {
    const ledger = state.loansLedger || {};
    const search = (ledger.pickerSearch || '').toLowerCase().trim();
    const all = [...(state.employees || [])].sort((a, b) => {
        const statusOrder = Number(a.active === false) - Number(b.active === false);
        if (statusOrder !== 0) return statusOrder;
        return String(a.number || a.name || '').localeCompare(String(b.number || b.name || ''), 'es', { numeric: true });
    });
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
                        <div style="color: #94a3b8; font-size: 0.78rem; margin-top: 2px;">Elige a quién registrarás el préstamo</div>
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
                            ${search ? 'No se encontraron empleados' : 'No hay empleados registrados'}
                        </div>
                    ` : filtered.map(emp => `
                        <div role="button" tabindex="0"
                             data-app-fn="pickEmployeeForNewLoan" data-arg="${emp.id}"
                             style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; cursor: pointer; transition: background 0.12s;"
                             onmouseover="this.style.background='#0f172a'"
                             onmouseout="this.style.background='transparent'">
                            <div style="width: 36px; height: 36px; background: rgba(6,182,212,0.12); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #06b6d4; font-weight: 800; font-size: 0.85rem;">
                                ${emp.number || '?'}
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <div style="display: flex; align-items: center; gap: 7px; min-width: 0;">
                                    <span style="color: #f1f5f9; font-weight: 700; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(emp.name)}</span>
                                    ${emp.active === false ? '<span class="loan-employee-status loan-employee-status--inactive">Inactivo</span>' : ''}
                                </div>
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
                <button type="button" data-app-fn="setLoanDraftField" data-arg="installmentMode" data-arg2="lump"
                        style="flex: 1; padding: 8px; background: ${!isInstallments ? '#06b6d4' : '#0f172a'}; color: ${!isInstallments ? '#000' : '#94a3b8'}; border: 1px solid ${!isInstallments ? '#06b6d4' : '#334155'}; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
                    Pago único
                </button>
                <button type="button" data-app-fn="setLoanDraftField" data-arg="installmentMode" data-arg2="installments"
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
